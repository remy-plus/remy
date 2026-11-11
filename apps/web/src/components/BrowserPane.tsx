import { useEffect, useRef, useState } from 'react';
import { type BrowserState, useApi } from '../api/index.tsx';
import { Skeleton } from './Skeleton.tsx';
import { buttonQuiet } from './ui.ts';

export const FRAME_EVERY_MS = 500;
const IDLE_EVERY_MS = 2000;
export const TAKE_OVER_COMMAND = 'remy browser show';

const revoke = (u: string | null) => {
  if (u?.startsWith('blob:')) URL.revokeObjectURL(u);
};

const host = (url?: string) => {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Whether the pane should refresh: tab in front and pane on screen. */
function useActive(ref: React.RefObject<HTMLElement | null>) {
  const [tab, setTab] = useState(() => document.visibilityState !== 'hidden');
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const on = () => setTab(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => {
      const last = es.at(-1);
      if (last) setOnScreen(last.isIntersecting);
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return tab && onScreen;
}

const small = `${buttonQuiet} px-3 py-[5px] text-[13px]`;

function TakeOver() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(TAKE_OVER_COMMAND);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // No clipboard here: the command is on screen to select.
    }
  };
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="take-over-note"
        onClick={() => setOpen(!open)}
        className={small}
      >
        Take over
      </button>
      {open && (
        <div
          id="take-over-note"
          role="note"
          className="absolute right-0 z-10 mt-2 w-[min(320px,80vw)] rounded-[14px] border border-edge-hi bg-surface p-4 text-[14px] leading-[1.6] text-text"
        >
          <p className="m-0">
            To sign in or enter a password yourself, run{' '}
            <code className="font-mono">{TAKE_OVER_COMMAND}</code> on this computer. Remy never
            types passwords or card numbers.
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={copy} className={small}>
              {copied ? 'Copied' : 'Copy command'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className={small}>
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Remy's own browser, live. `compact` is the small preview inside the chat. */
export function BrowserPane({ compact = false }: { compact?: boolean }) {
  const api = useApi();
  const root = useRef<HTMLElement>(null);
  const active = useActive(root);
  const [state, setState] = useState<BrowserState | null>(null);
  const [frame, setFrame] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const current = useRef<string | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const put = (next: string | null) => {
      const old = current.current;
      current.current = next;
      setFrame(next);
      if (old && old !== next) revoke(old);
    };
    const tick = async () => {
      let wait = IDLE_EVERY_MS;
      try {
        const s = await api.browserState();
        if (!live) return;
        setState(s);
        setProblem(false);
        if (s.open) {
          const f = await api.browserFrame();
          if (!live) return revoke(f);
          put(f);
          wait = FRAME_EVERY_MS;
        } else put(null);
      } catch {
        if (!live) return;
        setProblem(true);
      }
      if (live) timer = setTimeout(tick, wait);
    };
    void tick();
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [api, active]);

  useEffect(
    () => () => {
      revoke(current.current);
      current.current = null;
    },
    [],
  );

  const open = state?.open === true;
  const status = problem
    ? "Remy's browser can't be reached right now."
    : state === null
      ? "Looking for Remy's browser"
      : open
        ? `Remy is on ${host(state.url) || 'a page'}`
        : "Remy isn't using the browser right now";

  return (
    <section
      ref={root}
      aria-label="Remy's browser"
      className={compact ? 'w-full max-w-[320px]' : 'w-full'}
    >
      <div className="overflow-hidden rounded-[14px] bg-surface ring-1 ring-edge-hi">
        {/* The address bar is the top of the window, not a pill floating above it: a wide, faint
            outline with a gap under it reads as a stray rule rather than as chrome. */}
        {open && (
          <div className="flex min-w-0 items-center gap-3 border-b border-edge px-4 py-2 text-[13px]">
            <span className="min-w-0 truncate text-text">{state?.title || host(state?.url)}</span>
            <span className="min-w-0 flex-1 truncate text-right font-mono text-[12px] text-muted">
              {state?.url}
            </span>
          </div>
        )}
        {open && frame ? (
          <img
            src={frame}
            alt={state?.title ? `Remy's browser showing ${state.title}` : "Remy's browser"}
            className="block aspect-[16/10] w-full object-cover object-top"
          />
        ) : (
          <div className="flex aspect-[16/10] flex-col items-center justify-center gap-3 px-6 text-center text-[14px] leading-[1.6] text-muted">
            {problem ? (
              <p className="m-0">The view will come back when Remy is reachable.</p>
            ) : open ? (
              <Skeleton label="Loading the page" lines={3} className="w-full max-w-[280px]" />
            ) : (
              <>
                <p className="m-0">When Remy uses the web, you will see its browser here.</p>
                {!compact && (
                  <a
                    href="#/"
                    className="rounded-full border border-edge-hi px-4 py-2 text-[13px] font-medium text-text no-underline transition-colors duration-300 hover:bg-raise"
                  >
                    Ask Remy to look something up
                  </a>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p role="status" className="m-0 min-w-0 text-[13px] text-muted">
          {status}
        </p>
        {!compact && <TakeOver />}
      </div>
    </section>
  );
}
