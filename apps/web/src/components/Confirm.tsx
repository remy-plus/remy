import { type ReactNode, useEffect, useId, useRef } from 'react';
import { buttonPrimary, buttonQuiet } from './ui.ts';

/** A confirmation in a native modal dialog: focus is trapped, Esc cancels, the page behind is inert. */
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
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
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
            <button type="button" className={buttonPrimary} disabled={busy} onClick={onConfirm}>
              {confirmLabel}
            </button>
            <button type="button" className={buttonQuiet} onClick={onCancel}>
              {cancelLabel}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
