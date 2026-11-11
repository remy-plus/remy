// Push to talk. Hold Space (when no text box is focused) or fire the `remy:voice` window event.
// The browser's own speech recognition turns speech into words; Remy never records, stores or sends
// audio itself. Without that API the overlay says so and lets the person type instead.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../api/index.tsx';
import { describeError } from '../lib/errors.ts';
import { voiceClaim } from '../lib/voice.ts';
import { type VoiceMode, VoiceOverlay } from './VoiceOverlay.tsx';

interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const recognitionCtor = (): RecognitionCtor | null => {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const HOLD_MS = 300;
type Mode = VoiceMode;

/** True when a Space press belongs to something else: a field, a button, a link or an open dialog. */
const spaceIsTaken = (e: KeyboardEvent) => {
  const t = e.target;
  if (!(t instanceof Element)) return false;
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return true;
  if (document.querySelector('dialog[open]')) return true;
  return !!t.closest(
    'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable=false]), [role=combobox], [role=textbox], [role=switch], [role=radio]',
  );
};

export function PushToTalk() {
  const api = useApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const rec = useRef<Recognition | null>(null);
  const holding = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const [mode, setMode] = useState<Mode>('closed');
  const [final, setFinal] = useState('');
  const [interim, setInterim] = useState('');
  const [problem, setProblem] = useState('');
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');

  const stop = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onresult = r.onerror = r.onend = null;
      try {
        r.abort();
      } catch {
        // already stopped
      }
    }
    setListening(false);
  }, []);

  const close = useCallback(() => {
    stop();
    holding.current = false;
    setMode('closed');
  }, [stop]);

  const open = useCallback(() => {
    stop();
    setFinal('');
    setInterim('');
    setProblem('');
    setError('');
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setMode('editing'); // nothing can listen here, so the box is the way in
      return;
    }
    setMode('listening');
    try {
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language || 'en-GB';
      r.onresult = (e) => {
        let done = '';
        let part = '';
        for (let i = 0; i < e.results.length; i++) {
          const item = e.results[i];
          if (!item) continue;
          if (item.isFinal) done += item[0].transcript;
          else part += item[0].transcript;
        }
        setFinal(done.trim());
        setInterim(part);
      };
      r.onerror = (e) => {
        setListening(false);
        setProblem(
          e.error === 'not-allowed' || e.error === 'service-not-allowed'
            ? 'The microphone is blocked here. Type instead.'
            : e.error === 'no-speech'
              ? "Remy didn't hear anything. Try again, or type instead."
              : 'Listening stopped. Try again, or type instead.',
        );
      };
      r.onend = () => setListening(false);
      rec.current = r;
      r.start();
      setListening(true);
    } catch {
      setProblem("Listening didn't start. Type instead.");
    }
  }, [stop]);

  const text = `${final}${final && interim ? ' ' : ''}${interim}`.trim();
  const send = useCallback(
    async (words: string) => {
      const prompt = words.trim();
      if (!prompt) {
        close();
        return;
      }
      try {
        const { taskId } = await api.startTask(prompt);
        close();
        window.location.hash = `#/tasks/${encodeURIComponent(taskId)}`;
      } catch (e) {
        setError(describeError(e, 'Remy could not start that. Try again.'));
      }
    },
    [api, close],
  );

  // The key handlers are set up once, so they read the latest state through a ref.
  const live = useRef({ mode, text, send });
  useEffect(() => {
    live.current = { mode, text, send };
  });

  // The window event, and holding Space.
  useEffect(() => {
    const onEvent = () => {
      const c = voiceClaim();
      if (c) c.toggle();
      else open();
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (holding.current) {
        e.preventDefault(); // keep a held Space from scrolling or pressing buttons
        return;
      }
      if (e.repeat || spaceIsTaken(e)) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        holding.current = true;
        const c = voiceClaim();
        if (c) c.begin();
        else open();
      }, HOLD_MS);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      window.clearTimeout(timer.current);
      if (!holding.current) return;
      holding.current = false;
      e.preventDefault(); // the focused button must not take the release as a click
      const c = voiceClaim();
      if (c) c.release();
      else if (live.current.mode === 'listening') void live.current.send(live.current.text);
    };
    window.addEventListener('remy:voice', onEvent);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp, true);
    return () => {
      window.removeEventListener('remy:voice', onEvent);
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp, true);
      window.clearTimeout(timer.current);
    };
  }, [open]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (mode !== 'closed' && !d.open) {
      d.showModal();
      if (mode === 'listening') d.focus(); // not the first button: a held Space must not press it
    }
    if (mode === 'closed' && d.open) d.close();
  }, [mode]);

  return (
    <dialog
      ref={dialog}
      aria-label="Push to talk"
      tabIndex={-1}
      onClose={close}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if ((e.key === 'e' || e.key === 'E') && mode === 'listening') {
          e.preventDefault();
          stop();
          setFinal(text);
          setInterim('');
          setMode('editing');
        }
      }}
      className="m-0 size-full max-h-none max-w-none overflow-auto border-0 bg-bg bg-[radial-gradient(ellipse_at_50%_38%,#192018_0%,transparent_52%)] p-0 text-text outline-none backdrop:bg-black/80"
    >
      {mode !== 'closed' && (
        <VoiceOverlay
          mode={mode}
          listening={listening}
          final={final}
          interim={interim}
          problem={problem}
          error={error}
          canListen={recognitionCtor() !== null}
          onText={(v) => {
            setFinal(v);
            setError('');
          }}
          onSend={() => void send(mode === 'editing' ? final : text)}
          onEdit={() => {
            stop();
            setFinal(text);
            setInterim('');
            setMode('editing');
          }}
          onCancel={close}
        />
      )}
    </dialog>
  );
}
