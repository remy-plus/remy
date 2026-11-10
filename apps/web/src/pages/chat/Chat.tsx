// The front door: a conversation with Remy. `id` is absent for a new chat.
import { useCallback, useEffect, useRef, useState } from 'react';
import { type ChatView, useApi } from '../../api/index.tsx';
import { MindGlyph } from '../../components/MindGlyph.tsx';
import type { MindState } from '../../lib/mind.ts';
import { greeting } from '../../lib/when.ts';
import { Composer } from './Composer.tsx';
import { Turn } from './Feed.tsx';

const POLL_MS = 2000;
const DONE_MS = 2000;

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

const problemOf = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

function EmptyChat() {
  const api = useApi();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [voice, setVoice] = useState<VoiceNow>(IDLE);
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
    <div className="page-in mx-auto flex min-h-dvh w-full max-w-[720px] flex-col items-center justify-center px-5 pt-20 pb-12 text-center">
      <MindGlyph state={voice.state ?? 'rest'} level={voice.level} size={220} />
      <h1 className="m-0 mt-6 text-[34px] leading-[1.15] font-medium tracking-tight sm:text-[40px]">
        {greeting()}
      </h1>
      <p className="mt-2 mb-8 text-[18px] text-muted">What do you need?</p>
      <div className="w-full text-left">
        <Composer value={text} onChange={setText} onSend={send} onVoice={setVoice} big autoFocus />
      </div>
      {problem && (
        <p role="alert" className="mt-3 mb-0 text-[14px] text-muted">
          {problem}
        </p>
      )}
      <ul className="m-0 mt-6 flex list-none flex-wrap justify-center gap-2 p-0">
        {SUGGESTIONS.map((s, i) => (
          <li key={s} className="rise" style={{ '--i': i + 2 } as React.CSSProperties}>
            <button
              type="button"
              onClick={() => setText(s)}
              className="cursor-pointer rounded-full border border-edge bg-transparent px-4 py-2 text-[14px] text-text transition-colors duration-300 hover:bg-raise"
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
  const [justDone, setJustDone] = useState(false);
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

  // Just finished: the mind shows "done" for about two seconds, then rests.
  const was = useRef(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    if (was.current && !busy && chat) {
      setJustDone(true);
      t = setTimeout(() => setJustDone(false), DONE_MS);
    }
    was.current = busy;
    return () => clearTimeout(t);
  }, [busy, chat]);

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

  const resting: MindState = voice.state ?? (justDone ? 'done' : 'rest');
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
      <p role="status" className="px-5 pt-32 text-center text-[14px] text-muted">
        Opening the chat
      </p>
    );

  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-[760px] flex-1 px-5 pt-28 pb-44">
        <h1 className="sr-only">{chat.title}</h1>
        {chat.turns.map((t, i) => (
          <Turn
            key={t.taskId}
            turn={t}
            index={i}
            mind={i === chat.turns.length - 1 ? resting : 'rest'}
            onChanged={load}
            onRetry={(p) => void post(p)}
          />
        ))}
        <div ref={end} />
      </div>
      <div className="sticky bottom-0 bg-gradient-to-t from-bg from-70% to-transparent px-5 pt-4 pb-5">
        <div className="mx-auto max-w-[760px]">
          {problem && (
            <p role="alert" className="m-0 mb-2 px-2 text-[13px] text-muted">
              {problem}
            </p>
          )}
          {voice.state === 'listening' && (
            <div className="mb-2 flex justify-center">
              <MindGlyph state="listening" level={voice.level} size={160} />
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
            placeholder={busy ? 'Add something for next' : 'Ask Remy to do anything'}
          />
        </div>
      </div>
    </div>
  );
}

export function Chat({ id }: { id?: string }) {
  return id ? <OpenChat key={id} id={id} /> : <EmptyChat />;
}
