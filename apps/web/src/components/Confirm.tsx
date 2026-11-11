import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { describeError } from '../lib/errors.ts';
import { buttonPrimary, buttonQuiet } from './ui.ts';

/**
 * A confirmation in a native modal dialog: focus is trapped, Esc cancels, the page behind is inert.
 * The answer is awaited, so a delete that fails says why here instead of closing on a silent error.
 */
export function Confirm({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => unknown;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  // A new question starts clean: no error left over from the last one.
  useEffect(() => {
    if (open) setError(null);
  }, [open]);
  const go = async () => {
    setError(null);
    setWorking(true);
    try {
      await onConfirm();
    } catch (e) {
      setError(describeError(e, 'That did not go through. Try again.'));
    } finally {
      setWorking(false);
    }
  };
  const stopped = busy || working;
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onCancel}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        onCancel();
      }}
      className="m-auto w-[min(440px,calc(100vw-32px))] rounded-[14px] border border-edge-hi bg-surface p-6 text-text backdrop:bg-black/60"
    >
      {open && (
        <>
          <h2 id={titleId} className="m-0 text-[20px] font-medium">
            {title}
          </h2>
          <div className="mt-2 text-[14px] leading-snug text-muted">{children}</div>
          <div className="mt-5 flex flex-wrap gap-2">
            <button
              type="button"
              className={buttonPrimary}
              disabled={stopped}
              onClick={() => void go()}
            >
              {confirmLabel}
            </button>
            <button type="button" className={buttonQuiet} onClick={onCancel}>
              {cancelLabel}
            </button>
          </div>
          {stopped && (
            <p role="status" className="mt-3 mb-0 text-[13px] text-muted">
              Working
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 mb-0 text-[13px] leading-snug text-muted">
              {error}
            </p>
          )}
        </>
      )}
    </dialog>
  );
}
