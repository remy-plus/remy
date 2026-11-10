import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MindState } from '../../lib/mind.ts';
import { canSpeak, claimVoice, speakable, speakChunks, useListener } from '../../lib/voice.ts';
import { useSetting } from '../../settings.ts';

const pill =
  'cursor-pointer rounded-full border font-medium whitespace-nowrap transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:cursor-default disabled:opacity-40';

/**
 * The one input card. Enter sends, Shift+Enter starts a new line. While a job runs, `onStop` shows a
 * Stop button; typing stays open so the next message can wait its turn.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  big = false,
  placeholder = 'Ask Remy to do anything',
  autoFocus = false,
  hint,
  answer,
  onVoice,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  big?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** A calm line under the card, for example the message waiting to go next. */
  hint?: string;
  /** The final answer of the latest finished turn. When it changes and replies are spoken, it is read out. */
  answer?: { id: string; text: string };
  /** Tells the page what voice is doing: a state for the Mind (null when idle) and the mic level 0..1. */
  onVoice?: (v: { state: MindState | null; level: number }) => void;
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);
  const [voice, setVoice] = useSetting('voice');
  const speak = voice?.speak === true;
  const [speaking, setSpeaking] = useState(false);
  const stopSpeech = useRef<(() => void) | null>(null);
  const latest = useRef({ value, onSend });
  latest.current = { value, onSend };

  const cancelSpeech = useCallback(() => {
    stopSpeech.current?.();
    stopSpeech.current = null;
  }, []);
  const listener = useListener({
    getValue: () => latest.current.value,
    setValue: onChange,
    onPause: () => {
      if (latest.current.value.trim()) latest.current.onSend();
    },
    onStart: cancelSpeech,
  });
  const { listening, level, interim, problem, announce, supported } = listener;
  const { toggle, start, stop } = listener;

  // The talk window defers to this composer while it is on screen.
  useEffect(
    () => claimVoice({ toggle, begin: () => void start(), release: () => stop(true) }),
    [toggle, start, stop],
  );

  // Speak the final answer of a turn that finishes while this chat is open, never an old one.
  const seen = useRef(answer?.id);
  useEffect(() => {
    if (!answer || answer.id === seen.current) return;
    seen.current = answer.id;
    if (!speak || !canSpeak()) return;
    cancelSpeech();
    setSpeaking(true);
    stopSpeech.current = speakChunks(speakable(answer.text), () => setSpeaking(false));
  }, [answer, speak, cancelSpeech]);
  useEffect(() => cancelSpeech, [cancelSpeech]);
  useEffect(() => {
    if (!speak) cancelSpeech();
  }, [speak, cancelSpeech]);

  useEffect(() => {
    onVoice?.({ state: listening ? 'listening' : speaking ? 'working' : null, level });
  }, [listening, speaking, level, onVoice]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the box regrows whenever the text changes
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, big ? 240 : 180)}px`;
  }, [value, big]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim()) onSend();
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSend();
      }}
      className="w-full"
    >
      <div
        className={`flex items-end gap-2 rounded-[22px] border border-edge-hi bg-surface px-4 py-3 transition-[border-color,background-color] duration-300 focus-within:border-text/40 focus-within:bg-raise ${big ? 'min-h-[120px] sm:px-5 sm:py-4' : ''}`}
      >
        <label htmlFor={id} className="sr-only">
          Ask Remy to do anything
        </label>
        <textarea
          id={id}
          ref={area}
          rows={big ? 2 : 1}
          value={value}
          onChange={(e) => {
            listener.edited();
            onChange(e.target.value);
          }}
          onKeyDown={onKey}
          placeholder={placeholder}
          style={{ outline: 'none' }}
          className={`max-h-60 min-w-0 flex-1 resize-none border-0 bg-transparent py-2 text-text outline-none placeholder:text-muted ${big ? 'text-[18px] leading-[1.5]' : 'text-[16px] leading-[1.5]'}`}
        />
        <button
          type="button"
          aria-label="Speak replies"
          aria-pressed={speak}
          onClick={() => {
            if (speak) cancelSpeech();
            setVoice({ speak: !speak });
          }}
          className={`${pill} flex size-10 shrink-0 items-center justify-center border-edge-hi p-0 text-text hover:bg-raise ${speak ? 'bg-raise' : 'bg-transparent text-muted'}`}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 9v6h4l5 4V5L8 9H4z" />
            {speak ? (
              <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
            ) : (
              <path d="M17 9l5 6M22 9l-5 6" />
            )}
          </svg>
        </button>
        <button
          type="button"
          aria-label="Talk to Remy"
          aria-pressed={listening}
          onClick={toggle}
          className={`${pill} flex size-10 shrink-0 items-center justify-center border-edge-hi bg-transparent p-0 text-text hover:bg-raise ${listening ? 'bg-raise' : ''}`}
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </svg>
        </button>
        {(onStop || speaking) && (
          <button
            type="button"
            onClick={() => {
              cancelSpeech();
              onStop?.();
            }}
            className={`${pill} h-10 shrink-0 border-edge-hi bg-transparent px-4 text-[14px] text-text hover:bg-raise`}
          >
            Stop
          </button>
        )}
        <button
          type="submit"
          disabled={!value.trim()}
          className={`${pill} h-10 shrink-0 border-text bg-text px-5 text-[14px] text-bg hover:bg-white`}
        >
          Send
        </button>
      </div>
      {interim && (
        <p aria-hidden="true" className="m-0 mt-2 px-2 text-[14px] text-muted italic">
          {interim}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {(problem || (!supported && listening)) && (
        <p role="alert" className="m-0 mt-2 px-2 text-[13px] text-muted">
          {problem}
        </p>
      )}
      {hint && (
        <p role="status" className="m-0 mt-2 px-2 text-[13px] text-muted">
          {hint}
        </p>
      )}
    </form>
  );
}
