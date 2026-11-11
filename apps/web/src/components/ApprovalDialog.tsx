import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { type TaskView, useApi } from '../api/index.tsx';
import { describeError } from '../lib/errors.ts';
import { primaryButton, quietButton, RISK, trustSentence } from '../pages/tasks/format.ts';
import { Skeleton } from './Skeleton.tsx';

const mono = 'font-mono';

/** The text with one phrase marked, for example the corrected figure. */
function Marked({ text, mark }: { text: string; mark?: string }) {
  const at = mark ? text.indexOf(mark) : -1;
  if (!mark || at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-signal/20 px-1 text-text">{mark}</mark>
      {text.slice(at + mark.length)}
    </>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      className={`${mono} hidden rounded border border-edge px-1.5 text-[11px] text-muted sm:inline`}
    >
      {children}
    </kbd>
  );
}

/**
 * The approval, as the platform's own modal dialog: focus stays inside, and Esc closes it, which
 * here means "Not now". The buttons pass the card's own `argsHash` to the server; this never
 * makes a hash of its own, so a card that changed underneath is refused rather than approved.
 */
export function ApprovalDialog({
  taskId,
  view,
  onClose,
  onResolved,
  onEdit,
}: {
  taskId: string;
  /** The task, when the caller already has it. Otherwise it is fetched. */
  view?: TaskView;
  onClose: () => void;
  onResolved?: (granted: boolean) => void;
  /** Called by "Edit first". The caller decides where editing happens. */
  onEdit?: () => void;
}) {
  const api = useApi();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [task, setTask] = useState<TaskView | null>(view ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!view);

  useEffect(() => {
    if (view) {
      setTask(view);
      setLoading(false);
      return;
    }
    let live = true;
    api
      .getTask(taskId)
      .then((v) => {
        if (!live) return;
        setTask(v);
        setError(null);
      })
      .catch(
        (e: unknown) =>
          live && setError(describeError(e, 'Remy could not open this approval. Try again.')),
      )
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [api, taskId, view]);

  const card = task?.pendingApproval;
  // Nothing to approve any more (someone else answered it): close without a fuss.
  useEffect(() => {
    if (task && !task.pendingApproval) onClose();
  }, [task, onClose]);
  // The dialog opens at once and says what it is opening, rather than leaving the click unanswered.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!d.open) d.showModal();
    return () => {
      if (d.open) d.close();
    };
  }, []);

  const risk = card ? RISK[card.risk] : RISK.read;
  const detail = card?.detail;
  const effects = detail?.effects ?? [{ label: risk.kind, value: '' }];
  const canEdit = Boolean(detail?.canEdit && onEdit);

  const decide = async (granted: boolean) => {
    if (!card || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.approve(taskId, { callId: card.callId, argsHash: card.argsHash, granted });
      onResolved?.(granted);
      onClose();
    } catch (e) {
      setError(describeError(e, 'Remy could not record that. Try again.'));
      setBusy(false);
    }
  };
  const edit = () => {
    onEdit?.();
    onClose();
  };
  const keys = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const el = e.target as HTMLElement;
    const onControl = /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
    if (e.key === 'Enter' && !onControl) {
      e.preventDefault();
      void decide(true);
    } else if ((e.key === 'e' || e.key === 'E') && canEdit && !onControl) {
      e.preventDefault();
      edit();
    }
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onKeyDown={keys}
      onCancel={(e) => {
        e.preventDefault(); // Esc is a decision, not just a close
        if (card) void decide(false);
        else onClose();
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-y-auto rounded-t-[18px] border border-edge-hi bg-surface p-0 text-text backdrop:bg-black/70 sm:m-auto sm:max-w-[920px] sm:rounded-[18px]"
    >
      {loading ? (
        <div className="p-5 sm:p-8">
          <h2 id={titleId} className="sr-only">
            Opening this approval
          </h2>
          <Skeleton label="Opening this approval" lines={3} />
          <button type="button" onClick={onClose} className={`${quietButton} mt-5`}>
            Close
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-[minmax(0,1fr)_280px]">
          <div className="min-w-0 p-5 sm:p-8">
            <span
              aria-hidden="true"
              className="mx-auto mb-4 block h-1 w-10 rounded-full bg-stone/60 sm:hidden"
            />
            <p className={`${mono} m-0 text-[12px] text-muted`}>{risk.kind} · Waiting for you</p>
            <h2 className="mt-2 mb-5 text-[24px] leading-tight font-medium sm:text-[28px]">
              Is this OK?
            </h2>
            <p id={titleId} className="mt-0 mb-5 text-[16px] leading-snug text-muted">
              {detail?.title ?? 'Remy wants to take one action for you.'}
            </p>

            <div className="overflow-hidden rounded-[10px] border border-edge bg-bg">
              {detail?.headers && (
                <dl
                  className={`${mono} m-0 border-b border-edge px-4 py-3 text-[13px] leading-[1.7]`}
                >
                  {detail.headers.map((h) => (
                    <div key={h.k} className="flex gap-2">
                      <dt className="shrink-0 text-muted">{h.k}</dt>
                      <dd className="m-0 min-w-0 break-words">{h.v}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <div className="px-4 py-4 text-[15px] leading-[1.6]">
                {(detail?.body ?? [card?.preview ?? error ?? '']).map((p) => (
                  <p key={p} className="my-0 mb-3 whitespace-pre-line last:mb-0">
                    <Marked text={p} mark={detail?.highlight} />
                  </p>
                ))}
                {detail?.attachment && (
                  <p
                    className={`${mono} mt-4 mb-0 inline-block rounded-md border border-edge px-3 py-1.5 text-[12px]`}
                  >
                    {detail.attachment}
                  </p>
                )}
              </div>
            </div>

            {error && (
              <p role="alert" className={`${mono} mt-4 mb-0 text-[12px] text-text`}>
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              {card && (
                <>
                  <button
                    type="button"
                    // biome-ignore lint/a11y/noAutofocus: a dialog starts on its main action
                    autoFocus
                    disabled={busy}
                    onClick={() => decide(true)}
                    className={`${primaryButton} flex items-center justify-center gap-3 px-5 py-3 text-[14px]`}
                  >
                    {risk.approve} <Kbd>Enter</Kbd>
                  </button>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={edit}
                      className={`${quietButton} flex items-center justify-center gap-3 px-5 py-3 text-[14px]`}
                    >
                      Edit first <Kbd>E</Kbd>
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => decide(false)}
                    className={`${quietButton} flex items-center justify-center gap-3 px-5 py-3 text-[14px]`}
                  >
                    {risk.decline} <Kbd>Esc</Kbd>
                  </button>
                </>
              )}
              {!card && (
                <button type="button" onClick={onClose} className={quietButton}>
                  Close
                </button>
              )}
            </div>

            {/* What the answer does, before it is given. */}
            {card && (
              <p className="mt-4 mb-0 max-w-[520px] text-[13px] leading-relaxed text-muted">
                Approve: {risk.after} Not now: nothing happens and the job stops.
              </p>
            )}

            <div className="mt-4 sm:hidden">
              <ul className={`${mono} m-0 flex flex-wrap gap-2 p-0 text-[12px] text-muted`}>
                {[...effects.map((e) => e.label), 'Used once'].map((c) => (
                  <li key={c} className="list-none rounded-full border border-edge px-3 py-1">
                    {c}
                  </li>
                ))}
              </ul>
              <p className="mt-3 mb-0 text-center text-[13px] text-muted">
                Covers exactly this {risk.noun}. If anything changes, Remy asks again.
              </p>
            </div>
          </div>

          <aside
            aria-label="About this approval"
            className="hidden border-l border-edge bg-bg/60 p-6 sm:block"
          >
            <h3 className={`${mono} m-0 mb-2 text-[12px] font-normal text-muted`}>
              What this will do
            </h3>
            <ul className="m-0 mb-6 p-0">
              {effects.map((e) => (
                <li
                  key={e.label}
                  className="flex list-none items-baseline justify-between gap-3 border-b border-edge py-3 text-[14px] first:pt-1 last:border-b-0"
                >
                  <span>{e.label}</span>
                  {e.value && <span className={`${mono} text-[11px] text-muted`}>{e.value}</span>}
                </li>
              ))}
            </ul>
            <h3 className={`${mono} m-0 mb-2 text-[12px] font-normal text-muted`}>
              Why Remy is asking
            </h3>
            <p className="m-0 text-[14px] leading-[1.6] text-muted">
              {card?.reason ?? 'Remy needs your go-ahead before it goes further.'}{' '}
              {trustSentence[task?.config.trust ?? 'ask'] ?? trustSentence.ask}
            </p>
            <h3 className={`${mono} mt-6 mb-2 text-[12px] font-normal text-muted`}>
              This approval
            </h3>
            <p className="m-0 text-[14px] leading-[1.6] text-muted">
              Covers <strong className="font-medium text-text">exactly this {risk.noun}</strong> and
              nothing else. If Remy changes a word, it asks again. It can be used once.
            </p>
          </aside>
        </div>
      )}
    </dialog>
  );
}
