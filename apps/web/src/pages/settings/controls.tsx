import { type ReactNode, useId, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { type SaveState, useSaveState } from '../../settings.ts';

/** One labelled row: the name and a line of help on the left, the control on the right. */
export function Row({
  title,
  help,
  children,
  id,
}: {
  title: string;
  help?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <div className="grid gap-x-10 gap-y-3 border-t border-edge py-5 md:grid-cols-[minmax(0,284px)_minmax(0,1fr)]">
      <div>
        <h3 id={id} className="m-0 text-[15px] leading-snug font-medium">
          {title}
        </h3>
        {help && <p className="mt-1 mb-0 text-[13px] leading-snug text-muted">{help}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A switch with a visible label and help. The whole thing is one button, so it is easy to hit. */
export function Toggle({
  label,
  help,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  help?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex max-w-[520px] items-start justify-between gap-4">
      <div className="min-w-0">
        <p id={id} className="m-0 text-[15px] leading-snug">
          {label}
        </p>
        {help && <p className="mt-1 mb-0 text-[13px] leading-snug text-muted">{help}</p>}
      </div>
      <Switch labelledBy={id} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function Switch({
  labelledBy,
  label,
  checked,
  disabled,
  onChange,
}: {
  labelledBy?: string;
  label?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      aria-labelledby={labelledBy}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative mt-0.5 h-[22px] w-[38px] shrink-0 cursor-pointer rounded-full border p-0 disabled:cursor-default disabled:opacity-60 ${checked ? 'border-signal bg-signal' : 'border-edge-hi bg-transparent'}`}
    >
      <span
        aria-hidden="true"
        className={`absolute top-[2px] size-4 rounded-full transition-[left] ${checked ? 'left-[18px] bg-signal-ink' : 'left-[2px] bg-text'}`}
      />
    </button>
  );
}

export interface Choice<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

/** A radio group drawn as joined buttons. Real radio inputs, so arrow keys and focus work natively. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Choice<T>[];
  onChange: (v: T) => void;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap overflow-hidden rounded-md border border-edge-hi"
    >
      {options.map((o, i) => (
        <label key={o.value} className={`relative flex ${i > 0 ? 'border-l border-l-stone' : ''}`}>
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={o.value === value}
            disabled={o.disabled}
            onChange={() => onChange(o.value)}
            className="peer absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-default"
          />
          <span className="bg-transparent px-4 py-[9px] text-[14px] text-muted peer-checked:bg-text peer-checked:font-medium peer-checked:text-bg peer-hover:text-text peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-text peer-disabled:text-muted peer-disabled:opacity-70">
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

/** A number box with a currency sign in front. */
export function Money({
  label,
  symbol,
  value,
  onChange,
}: {
  label: string;
  symbol: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value)); // free text while typing, so the box can be emptied
  return (
    <label className="flex h-[38px] w-[140px] items-center gap-2 rounded-md border border-edge-hi bg-surface px-3 text-[13px] text-text focus-within:border-text">
      <span aria-hidden="true">{symbol}</span>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        step={0.5}
        aria-label={label}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number.parseFloat(e.target.value);
          if (Number.isFinite(n) && n >= 0) onChange(n);
        }}
        className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[13px] text-text outline-none"
      />
    </label>
  );
}

export const money = (symbol: string, n: number) => `${symbol}${n.toFixed(2)}`;

/**
 * The outcome of this section's own last write. The page already says Saved at the top, but a person
 * who just changed a number is looking at the number, so the section says it there too. `touch` marks
 * that this section made a change; until then the note stays quiet, so a save from another section
 * never shows up here as if it were this one's.
 */
export function useOwnSave(): { state: SaveState; touch: () => void } {
  const save = useSaveState();
  const [touched, setTouched] = useState(false);
  return { state: touched ? save : 'idle', touch: () => setTouched(true) };
}

/** One line under a control that writes to the server: saving, saved, or what to do about a failure. */
export function SaveNote({ state, what }: { state: SaveState; what: string }) {
  if (state === 'idle') return null;
  return (
    <p role="status" className="mt-3 mb-0 flex items-center gap-2 text-[13px] text-muted">
      {state === 'saved' && <Icon name="check" className="shrink-0 text-signal" />}
      {state === 'saving' && `Saving the ${what}`}
      {state === 'saved' && `The ${what} is saved.`}
      {state === 'failed' &&
        `The ${what} did not save. Check that Remy is running, then try again.`}
    </p>
  );
}

/** A failure inside one row: what went wrong, and a way to try again. */
export function RowError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="status" className="max-w-[520px]">
      <p className="m-0 text-[14px] leading-relaxed">{message}</p>
      <button type="button" onClick={onRetry} className={`${buttonQuiet} mt-3`}>
        Try again
      </button>
    </div>
  );
}
