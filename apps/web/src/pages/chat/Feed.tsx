import { type CSSProperties, useEffect, useState } from 'react';
import { type ChatTurn, type TaskView, useApi } from '../../api/index.tsx';
import { BrowserPane } from '../../components/BrowserPane.tsx';
import { MindGlyph } from '../../components/MindGlyph.tsx';
import { type FeedLine, feedLines } from '../../lib/feed.ts';
import type { MindState } from '../../lib/mind.ts';
import { ago } from '../../lib/when.ts';
import { useTask } from '../tasks/useTask.ts';
import { ApprovalInline } from './ApprovalInline.tsx';

const pill =
  'cursor-pointer rounded-full border px-4 py-[8px] text-[14px] font-medium whitespace-nowrap transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:cursor-default disabled:opacity-50';
const quiet = `${pill} border-edge-hi bg-transparent text-text hover:bg-raise`;

type Phase = 'thinking' | 'working' | 'waiting';

const rise = (i: number) => ({ '--i': Math.min(i, 8) }) as CSSProperties;

function Marker({ state }: { state: FeedLine['state'] }) {
  const base = 'mt-[7px] flex size-4 shrink-0 items-center justify-center rounded-full';
  if (state === 'done')
    return (
      <span aria-hidden="true" className={`${base} border border-signal text-[10px] text-signal`}>
        ✓
      </span>
    );
  if (state === 'failed')
    return (
      <span
        aria-hidden="true"
        className={`${base} bg-text font-mono text-[11px] font-bold text-bg`}
      >
        !
      </span>
    );
  if (state === 'waiting')
    return (
      <span aria-hidden="true" className={`${base} border border-text`}>
        <span className="size-1.5 rounded-full bg-text" />
      </span>
    );
  return (
    <span aria-hidden="true" className={base}>
      <span className="size-2 motion-safe:animate-pulse rounded-full bg-signal" />
    </span>
  );
}

const WORD: Record<FeedLine['state'], string> = {
  done: 'done',
  working: 'in progress',
  waiting: 'waiting for you',
  failed: 'did not work out',
};

/** One line per step, in plain words. Tap a line for what it did and what came back. */
export function FeedList({ lines }: { lines: FeedLine[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <ul
      role="log"
      aria-live="polite"
      aria-label="What Remy is doing"
      className="m-0 flex list-none flex-col gap-1 p-0"
    >
      {lines.map((l, i) => {
        const when = l.at ? ago(l.at) : '';
        const expanded = open === l.id;
        return (
          <li key={l.id} style={rise(i)} className="rise min-w-0">
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setOpen(expanded ? null : l.id)}
              className="flex w-full min-w-0 cursor-pointer items-start gap-3 rounded-lg border-0 bg-transparent px-1 py-0.5 text-left text-[15px] leading-[1.6] text-text hover:bg-raise"
            >
              <Marker state={l.state} />
              <span className="min-w-0 flex-1">
                {l.text}
                <span className="sr-only"> ({WORD[l.state]})</span>
              </span>
            </button>
            {expanded && (
              <div className="mt-1 mb-2 ml-8 text-[13px] leading-[1.6] text-muted">
                <p className="m-0">{l.detail}</p>
                {l.snippet && <p className="mt-1 mb-0 break-words">{l.snippet}</p>}
                {when && <p className="mt-1 mb-0">{when}</p>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Answer({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // No clipboard here: the text is still on screen to select.
    }
  };
  return (
    <div className="rise mt-3" style={rise(1)}>
      {paragraphs.map((p) => (
        <p key={p} className="mt-0 mb-3 text-[16px] leading-[1.7] break-words text-text">
          {p}
        </p>
      ))}
      <button type="button" onClick={copy} className={`${quiet} px-3 py-[5px] text-[13px]`}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function Question({
  taskId,
  question,
  onDone,
}: {
  taskId: string;
  question: string;
  onDone: () => void;
}) {
  const api = useApi();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    try {
      await api.answer(taskId, t);
      setText('');
      onDone();
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Remy could not send that.');
    }
  };
  return (
    <section
      aria-label="Remy has a question"
      className="rise mt-3 rounded-[14px] border border-edge-hi bg-surface p-4"
    >
      <p className="m-0 text-[15px] leading-[1.6]">{question}</p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          aria-label="Your answer"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type your answer"
          className="min-w-0 flex-1 rounded-full border border-edge bg-transparent px-4 py-2 text-[15px] text-text outline-none placeholder:text-muted focus:border-stone"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className={`${pill} border-text bg-text text-bg hover:bg-white`}
        >
          Answer
        </button>
      </form>
      {problem && (
        <p role="alert" className="mt-2 mb-0 text-[13px] text-muted">
          {problem}
        </p>
      )}
    </section>
  );
}

function Failed({
  stopped,
  reason,
  onRetry,
}: {
  stopped: boolean;
  reason?: string;
  onRetry: () => void;
}) {
  return (
    <div className="rise mt-3" style={rise(1)}>
      <p className="m-0 text-[16px] leading-[1.7] text-text">
        {stopped ? "I didn't finish that." : "I couldn't finish that."}
      </p>
      {reason && <p className="mt-1 mb-0 text-[14px] leading-[1.6] text-muted">{reason}</p>}
      <button type="button" onClick={onRetry} className={`${quiet} mt-3`}>
        Try again
      </button>
    </div>
  );
}

function Shell({ mind, children }: { mind: MindState; children: React.ReactNode }) {
  return (
    <div className="mt-4 flex gap-3">
      <div className="mt-1 shrink-0">
        <MindGlyph state={mind} size={40} />
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const reasonOf = (v: TaskView | null) => v?.final?.reason ?? v?.failure?.body;

/** A turn still going: follows the job's stream and shows what it is doing right now. */
function LiveBlock({ turn, onChanged }: { turn: ChatTurn; onChanged: () => void }) {
  const { view, reload } = useTask(turn.taskId);
  const card = view?.pendingApproval;
  const question = view?.pendingQuestion;
  const phase: Phase =
    card || question || turn.state === 'waiting'
      ? 'waiting'
      : view?.calls.some((c) => c.inFlight)
        ? 'working'
        : 'thinking';

  const lines = view ? feedLines(view.calls, card?.callId) : [];
  const resolved = () => {
    reload();
    onChanged();
  };
  return (
    <Shell mind={phase}>
      {lines.length > 0 ? (
        <FeedList lines={lines} />
      ) : (
        <p role="status" className="m-0 py-0.5 text-[15px] leading-[1.6] text-muted">
          {phase === 'waiting' ? 'Waiting for you' : 'Thinking it through'}
        </p>
      )}
      {view?.calls.some((c) => c.inFlight && c.tool.startsWith('browser')) && (
        <div className="mt-2">
          <BrowserPane compact />
          <a href="#/browser" className="mt-1 inline-block text-[13px] text-muted hover:text-text">
            Open Browser
          </a>
        </div>
      )}
      {card && <ApprovalInline taskId={turn.taskId} card={card} onResolved={resolved} />}
      {question && !card && (
        <Question taskId={turn.taskId} question={question.question} onDone={resolved} />
      )}
    </Shell>
  );
}

/** A turn that has ended: the feed folds into one line, then the answer or the reason. */
function EndedBlock({
  turn,
  mind,
  onRetry,
}: {
  turn: ChatTurn;
  mind: MindState;
  onRetry: (prompt: string) => void;
}) {
  const api = useApi();
  const [view, setView] = useState<TaskView | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    api
      .getTask(turn.taskId)
      .then((v) => live && setView(v))
      .catch(() => {
        // Without the job's details the answer still shows; there is just no feed to unfold.
      });
    return () => {
      live = false;
    };
  }, [api, turn.taskId]);

  const lines = view ? feedLines(view.calls) : [];
  const answer = turn.answer ?? view?.final?.answer;
  const failed = turn.state === 'failed' || turn.state === 'stopped';
  return (
    <Shell mind={mind}>
      {lines.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={shown}
            onClick={() => setShown(!shown)}
            className="cursor-pointer rounded-lg border-0 bg-transparent px-1 py-0.5 text-[14px] text-muted hover:text-text"
          >
            What I did ({lines.length} {lines.length === 1 ? 'step' : 'steps'})
          </button>
          {shown && (
            <div className="mt-1">
              <FeedList lines={lines} />
            </div>
          )}
        </div>
      )}
      {failed ? (
        <Failed
          stopped={turn.state === 'stopped'}
          {...(reasonOf(view) && { reason: reasonOf(view) })}
          onRetry={() => onRetry(turn.prompt)}
        />
      ) : (
        answer && <Answer text={answer} />
      )}
    </Shell>
  );
}

/** One exchange: the person's message, then Remy's block. `mind` is the glyph's state once it has ended. */
export function Turn({
  turn,
  index,
  mind = 'rest',
  onChanged,
  onRetry,
}: {
  turn: ChatTurn;
  index: number;
  mind?: MindState;
  onChanged: () => void;
  onRetry: (prompt: string) => void;
}) {
  const live = turn.state === 'working' || turn.state === 'waiting';
  return (
    <article className="mb-10" aria-label={`You asked: ${turn.prompt}`}>
      <div className="rise flex justify-end" style={rise(index === 0 ? 0 : 1)}>
        <p className="m-0 max-w-[85%] rounded-2xl bg-surface px-4 py-3 text-[16px] leading-[1.6] break-words whitespace-pre-wrap text-text">
          {turn.prompt}
        </p>
      </div>
      {live ? (
        <LiveBlock turn={turn} onChanged={onChanged} />
      ) : (
        <EndedBlock turn={turn} mind={mind} onRetry={onRetry} />
      )}
    </article>
  );
}
