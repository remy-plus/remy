// The front door: a conversation with Remy. `id` is absent for a new chat.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ChatSummary, type ChatView, useApi } from '../../api/index.tsx';
import { Icon } from '../../components/Icon.tsx';
import { MindGlyph } from '../../components/MindGlyph.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { describeError } from '../../lib/errors.ts';
import type { MindState } from '../../lib/mind.ts';
import { ago, greeting } from '../../lib/when.ts';
import { Composer } from './Composer.tsx';
import { Turn } from './Feed.tsx';

const POLL_MS = 2000;

const SUGGESTIONS = [
  'Summarise the files in my Documents folder',
  'Find flights to Lisbon in March under 200 pounds',
  'Draft a reply to my latest email from Dana',
  'Plan my week around the dentist on Tuesday',
];

interface VoiceNow {
  state: MindState | null;
  level: number;
}
const IDLE: VoiceNow = { state: null, level: 0 };

const problemOf = (e: unknown, fallback: string) => describeError(e, fallback);

/** The newest chat, so the front door offers to carry on instead of asking the person to start over. */
function useLastChat(): ChatSummary | null {
  const api = useApi();
  const [last, setLast] = useState<ChatSummary | null>(null);
  useEffect(() => {
    let live = true;
    api
      .listChats()
      .then((c) => live && setLast(c[0] ?? null))
      .catch(() => {}); // no history is not a problem worth a message
    return () => {
      live = false;
    };
  }, [api]);
  return last;
}

function EmptyChat() {
  const api = useApi();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [voice, setVoice] = useState<VoiceNow>(IDLE);
  const last = useLastChat();
  const send = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const { chatId } = await api.sendMessage(t, undefined);
      setText('');
      window.location.hash = `#/chat/${encodeURIComponent(chatId)}`;
    } catch (e) {
      setProblem(problemOf(e, 'Remy could not start that. Try again.'));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="page-in mx-auto flex min-h-[calc(100dvh-80px)] w-full max-w-[560px] flex-col items-center justify-center px-4 pb-16 text-center">
      <MindGlyph state={voice.state ?? 'rest'} level={voice.level} size={128} />
      <h1 className="m-0 mt-4 text-[28px] leading-[1.2] font-medium tracking-tight">
        {greeting()}
      </h1>
      <p className="mt-1 mb-6 text-[15px] text-muted">What do you need?</p>
      <div className="w-full text-left">
        <Composer value={text} onChange={setText} onSend={send} onVoice={setVoice} autoFocus />
      </div>
      <p className="mt-2.5 mb-0 w-full px-4 text-left text-[13px] leading-snug text-muted">
        Remy asks before it sends anything as you or spends money.
      </p>
      {problem && (
        <p role="alert" className="mt-3 mb-0 text-[14px] text-muted">
          {problem}
        </p>
      )}
      {last && (
        <a
          href={`#/chat/${encodeURIComponent(last.id)}`}
          className="mt-5 flex w-full items-center gap-3 rounded-[14px] border border-edge bg-surface px-4 py-3 text-left text-text no-underline transition-colors duration-300 hover:border-edge-hi hover:bg-raise"
        >
          <Icon name="clock" className="shrink-0 text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] text-muted">Pick up where you left off</span>
            <span className="mt-0.5 block text-[15px] leading-snug break-words">{last.title}</span>
          </span>
          <span className="shrink-0 text-[12px] text-muted">{ago(last.updatedAt)}</span>
        </a>
      )}
      <ul className="m-0 mt-4 flex w-full list-none flex-col gap-0.5 p-0 text-left">
        {SUGGESTIONS.map((s, i) => (
          <li key={s} className="rise" style={{ '--i': i + 2 } as React.CSSProperties}>
            <button
              type="button"
              onClick={() => setText(s)}
              className="w-full cursor-pointer rounded-[10px] border-0 bg-transparent px-4 py-2 text-left text-[14px] leading-snug text-muted transition-colors duration-300 hover:bg-surface hover:text-text"
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const working = (c: ChatView | null) =>
  c?.turns.some((t) => t.state === 'working' || t.state === 'waiting') ?? false;

function OpenChat({ id }: { id: string }) {
  const api = useApi();
  const [chat, setChat] = useState<ChatView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [queued, setQueued] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [voice, setVoice] = useState<VoiceNow>(IDLE);
  const end = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setChat(await api.getChat(id));
      setError(null);
    } catch (e) {
      setError(problemOf(e, 'Remy could not open this chat.'));
    }
  }, [api, id]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new chat starts empty
  useEffect(() => {
    setChat(null);
    setQueued(null);
    void load();
  }, [id]);

  const busy = working(chat);
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [busy, load]);

  const turnCount = chat?.turns.length ?? 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a turn is added
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
  }, [turnCount]);

  // New lines, an approval card or an answer make the chat taller: follow them, but only when the
  // person is already near the bottom, so reading further up is never interrupted.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-attach when the chat (and its column) first appears
  useEffect(() => {
    const col = end.current?.parentElement;
    if (!col || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const gap = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
      if (gap < 420) end.current?.scrollIntoView?.({ block: 'end', behavior: 'smooth' });
    });
    ro.observe(col);
    return () => ro.disconnect();
  }, [chat?.id]);

  const post = useCallback(
    async (t: string) => {
      setProblem(null);
      try {
        await api.sendMessage(t, id);
        await load();
      } catch (e) {
        setProblem(problemOf(e, 'Remy could not send that. Try again.'));
      }
    },
    [api, id, load],
  );

  // The queued message goes as soon as the current job ends.
  useEffect(() => {
    if (queued && chat && !busy) {
      const next = queued;
      setQueued(null);
      void post(next);
    }
  }, [queued, chat, busy, post]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    if (busy) setQueued(t);
    else void post(t);
  };

  const stop = async () => {
    const live = chat?.turns.filter((t) => t.state === 'working' || t.state === 'waiting') ?? [];
    try {
      await Promise.all(live.map((t) => api.cancel(t.taskId)));
      await load();
    } catch (e) {
      setProblem(problemOf(e, 'Remy could not stop that.'));
    }
  };

  const last = chat?.turns.at(-1);
  const spoken =
    last?.state === 'done' && last.answer ? { id: last.taskId, text: last.answer } : undefined;

  if (error && !chat)
    return (
      <div className="mx-auto max-w-[760px] px-5 pt-32 text-center">
        <h1 className="m-0 text-[24px] font-medium">I couldn't open this chat.</h1>
        <p className="mt-2 text-muted">{error}</p>
        <a
          href="#/"
          className="mt-4 inline-block rounded-full border border-edge-hi px-4 py-2 text-[14px] text-text no-underline hover:bg-raise"
        >
          Start a new chat
        </a>
      </div>
    );
  if (!chat)
    return (
      <div className="mx-auto w-full max-w-[720px] px-4 pt-6">
        <div className="flex justify-end">
          <span
            aria-hidden="true"
            className="skeleton block h-10 w-[min(60%,320px)] rounded-[18px]"
          />
        </div>
        <div className="mt-6 flex gap-3">
          <div className="hidden shrink-0 sm:block">
            <MindGlyph state="thinking" size={48} />
          </div>
          <Skeleton label="Opening your chat" lines={3} className="min-w-0 flex-1" />
        </div>
      </div>
    );

  return (
    <div className="flex min-h-[calc(100dvh-80px)] flex-col">
      <div className="mx-auto w-full max-w-[720px] flex-1 px-4 pt-4 pb-8">
        <h1 className="sr-only">{chat.title}</h1>
        {chat.turns.map((t, i) => (
          <Turn key={t.taskId} turn={t} index={i} onChanged={load} onRetry={(p) => void post(p)} />
        ))}
        <div ref={end} />
      </div>
      <div className="sticky bottom-0 bg-bg px-4 pt-2 pb-[max(12px,env(safe-area-inset-bottom))]">
        {/* The feed fades under the composer instead of being sliced by its top edge. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 -top-10 h-10 bg-[linear-gradient(to_top,var(--bg),transparent)]"
        />
        <div className="mx-auto max-w-[688px]">
          {problem && (
            <p role="alert" className="m-0 mb-2 px-4 text-[13px] text-muted">
              {problem}
            </p>
          )}
          {voice.state === 'listening' && (
            <div className="mb-2 flex justify-center">
              <MindGlyph state="listening" level={voice.level} size={96} />
            </div>
          )}
          <Composer
            value={text}
            onChange={setText}
            onSend={send}
            onVoice={setVoice}
            {...(spoken && { answer: spoken })}
            {...(busy && { onStop: stop })}
            {...(queued && { hint: `Next, when I'm done: ${queued}` })}
            placeholder={busy ? 'Add a follow-up' : 'Ask Remy to do anything'}
          />
        </div>
      </div>
    </div>
  );
}

export function Chat({ id }: { id?: string }) {
  return id ? <OpenChat key={id} id={id} /> : <EmptyChat />;
}
