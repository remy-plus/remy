import { type KeyboardEvent, useEffect, useId, useRef } from 'react';

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
}) {
  const id = useId();
  const area = useRef<HTMLTextAreaElement>(null);

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
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          placeholder={placeholder}
          style={{ outline: 'none' }}
          className={`max-h-60 min-w-0 flex-1 resize-none border-0 bg-transparent py-2 text-text outline-none placeholder:text-muted ${big ? 'text-[18px] leading-[1.5]' : 'text-[16px] leading-[1.5]'}`}
        />
        <button
          type="button"
          aria-label="Talk to Remy"
          onClick={() => window.dispatchEvent(new CustomEvent('remy:voice'))}
          className={`${pill} flex size-10 shrink-0 items-center justify-center border-edge-hi bg-transparent p-0 text-text hover:bg-raise`}
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
        {onStop && (
          <button
            type="button"
            onClick={onStop}
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
      {hint && (
        <p role="status" className="m-0 mt-2 px-2 text-[13px] text-muted">
          {hint}
        </p>
      )}
    </form>
  );
}
