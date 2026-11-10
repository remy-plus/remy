import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import type { MindState } from '../../lib/mind.ts';
import {
  canSpeak,
  claimVoice,
  speakable,
  speakChunks,
  unlockAudio,
  useListener,
} from '../../lib/voice.ts';
import { useSetting } from '../../settings.ts';

/** A 16 px line icon. Decorative: the button around it carries the name. */
function Icon({
  children,
  fill = 'none',
  strokeWidth = 1.6,
}: {
  children: React.ReactNode;
  fill?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const MAX = 144; // six lines of 24 px. The textarea has no padding of its own, so a full box scrolls on whole lines.

/**
 * The one input: a single line that grows as the text does, up to six. Enter sends, Shift+Enter starts a new line. While a job runs, `onStop` shows a
 * Stop button; typing stays open so the next message can wait its turn.
 */
export function Composer({
  value,
  onChange,
  onSend,
  onStop,
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

  // One observer for the life of the box: it regrows when the width changes (a Stop button appearing
  // narrows it), so one line never shows as two. Typing calls `grow` directly.
  const grow = useCallback(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX)}px`;
  }, []);
  useEffect(() => {
    const el = area.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        grow();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [grow]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: value and placeholder change the measured text
  useEffect(grow, [value, placeholder, grow]);

  useEffect(() => {
    if (autoFocus) area.current?.focus();
  }, [autoFocus]);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (value.trim()) onSend();
    }
  };

  const ghost =
    'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full p-0 sm:size-8 transition-[color,background-color,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.96] disabled:cursor-default';

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSend();
      }}
      className="w-full"
    >
      <div className="flex items-end gap-1 rounded-[24px] border border-edge bg-surface p-2 pl-4 transition-colors duration-300 focus-within:border-text/30 focus-within:bg-raise">
        <label htmlFor={id} className="sr-only">
          Ask Remy to do anything
        </label>
        <textarea
          id={id}
          ref={area}
          rows={1}
          value={value}
          onChange={(e) => {
            listener.edited();
            onChange(e.target.value);
          }}
          onKeyDown={onKey}
          placeholder={placeholder}
          style={{ outline: 'none' }}
          className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden max-h-[144px] min-w-0 flex-1 resize-none overflow-x-hidden border-0 bg-transparent p-0 my-1 text-[16px] leading-6 text-text outline-none placeholder:text-muted sm:text-[15px]"
        />
        <button
          type="button"
          aria-label="Speak replies"
          aria-pressed={speak}
          onClick={() => {
            if (speak) cancelSpeech();
            else unlockAudio();
            setVoice({ speak: !speak });
          }}
          className={`${ghost} hover:bg-raise hover:text-text ${speak ? 'text-text' : 'text-muted'}`}
        >
          <Icon>
            <path d="M4 9v6h4l5 4V5L8 9H4z" />
            {speak ? (
              <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
            ) : (
              <path d="M17 9l5 6M22 9l-5 6" />
            )}
          </Icon>
        </button>
        <button
          type="button"
          aria-label="Talk to Remy"
          aria-pressed={listening}
          onClick={toggle}
          className={`${ghost} hover:bg-raise hover:text-text ${listening ? 'bg-raise text-text' : 'text-muted'}`}
        >
          <Icon>
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
          </Icon>
        </button>
        {(onStop || speaking) && (
          <button
            type="button"
            aria-label="Stop"
            onClick={() => {
              cancelSpeech();
              onStop?.();
            }}
            className={`${ghost} ring-1 ring-edge-hi text-text hover:bg-raise`}
          >
            <Icon fill="currentColor" strokeWidth={0}>
              <rect x="7" y="7" width="10" height="10" rx="2" />
            </Icon>
          </button>
        )}
        <button
          type="submit"
          aria-label="Send"
          disabled={!value.trim()}
          className={`${ghost} ${value.trim() ? 'bg-text text-bg hover:bg-white' : 'bg-raise text-muted'}`}
        >
          <Icon strokeWidth={2}>
            <path d="M12 19V5M6 11l6-6 6 6" />
          </Icon>
        </button>
      </div>
      {interim && (
        <p aria-hidden="true" className="m-0 mt-2 px-4 text-[14px] text-muted">
          {interim}
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {announce}
      </p>
      {(problem || (!supported && listening)) && (
        <p role="alert" className="m-0 mt-2 px-4 text-[13px] text-muted">
          {problem}
        </p>
      )}
      {hint && (
        <p role="status" className="m-0 mt-2 px-4 text-[13px] text-muted">
          {hint}
        </p>
      )}
    </form>
  );
}
