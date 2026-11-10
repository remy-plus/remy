import { useEffect, useRef, useState } from 'react';
import { type ApprovalCard, useApi } from '../../api/index.tsx';
import { approvalSentence } from '../../lib/feed.ts';

const pill =
  'cursor-pointer rounded-full border px-4 py-[8px] text-[14px] font-medium whitespace-nowrap transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:cursor-default disabled:opacity-50';

const editable = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON', 'A'].includes(t.tagName));

/**
 * "Is this OK?" in the flow of the chat. Approve or Not now go to the server with the card's own
 * call id and hash, so the answer binds to exactly what was shown. Enter approves, Esc declines
 * (unless the person is typing).
 */
export function ApprovalInline({
  taskId,
  card,
  onResolved,
}: {
  taskId: string;
  card: ApprovalCard;
  onResolved: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const answer = useRef<(granted: boolean) => void>(() => {});
  answer.current = async (granted) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await api.approve(taskId, { callId: card.callId, argsHash: card.argsHash, granted });
      onResolved();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Remy could not send that. Try again.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') answer.current(false);
      else if (e.key === 'Enter' && !editable(e.target)) answer.current(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section
      aria-label="Is this OK?"
      className="rise mt-3 rounded-[14px] border border-edge-hi bg-surface p-4"
    >
      <h3 className="m-0 text-[15px] font-medium">Is this OK?</h3>
      <p className="mt-2 mb-0 text-[15px] leading-[1.6] text-text">
        {approvalSentence(card.preview, card.risk)}
      </p>
      {card.reason && <p className="mt-1 mb-0 text-[13px] text-muted">{card.reason}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => answer.current(true)}
          className={`${pill} border-text bg-text text-bg hover:bg-white`}
        >
          Approve
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => answer.current(false)}
          className={`${pill} border-edge-hi bg-transparent text-text hover:bg-raise`}
        >
          Not now
        </button>
        <span aria-hidden="true" className="font-mono text-[12px] text-muted">
          Enter to approve, Esc to decline
        </span>
      </div>
      {problem && (
        <p role="alert" className="mt-3 mb-0 text-[13px] text-muted">
          {problem}
        </p>
      )}
    </section>
  );
}
