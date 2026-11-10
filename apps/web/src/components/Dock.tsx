import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type ChatSummary, useApi } from '../api/index.tsx';
import type { MindState } from '../lib/mind.ts';
import { DEFAULTS, useSetting } from '../settings.ts';
import { HistoryDrawer } from './HistoryDrawer.tsx';
import { Icon } from './Icon.tsx';
import { MindGlyph } from './MindGlyph.tsx';

export interface DockItem {
  id: string;
  label: string;
  href: string;
  match: (p: string) => boolean;
}

export const DOCK_ITEMS: DockItem[] = [
  {
    id: 'chat',
    label: 'Chat',
    href: '#/',
    match: (p) => p === '/' || p.startsWith('/chat/'),
  },
  {
    id: 'activity',
    label: 'Activity',
    href: '#/activity',
    match: (p) =>
      p === '/activity' ||
      p === '/tasks' ||
      p.startsWith('/tasks/') ||
      p === '/review' ||
      p.startsWith('/schedules'),
  },
  { id: 'browser', label: 'Browser', href: '#/browser', match: (p) => p === '/browser' },
  { id: 'brain', label: 'Brain', href: '#/brain', match: (p) => p === '/brain' || p === '/skills' },
  {
    id: 'connections',
    label: 'Connections',
    href: '#/connections',
    match: (p) => p === '/connections' || p.startsWith('/connections/'),
  },
  {
    id: 'settings',
    label: 'Settings',
    href: '#/settings',
    match: (p) => p === '/settings' || p.startsWith('/settings/'),
  },
];

/** The items to show: only known ids, once each, in the saved order. Chat and Settings are always there. */
export function dockItems(ids: readonly string[]): DockItem[] {
  const chosen = ids.filter((id, i) => ids.indexOf(id) === i);
  if (!chosen.includes('chat')) chosen.unshift('chat');
  if (!chosen.includes('settings')) chosen.push('settings');
  return chosen.map((id) => DOCK_ITEMS.find((d) => d.id === id)).filter((d): d is DockItem => !!d);
}

/** Working beats waiting beats rest. */
export function mindOf(chats: readonly ChatSummary[]): MindState {
  if (chats.some((c) => c.state === 'working')) return 'working';
  if (chats.some((c) => c.state === 'waiting')) return 'waiting';
  return 'rest';
}

const QUERY = '(max-width: 640px)';
const subscribe = (notify: () => void) => {
  const m = window.matchMedia?.(QUERY);
  m?.addEventListener?.('change', notify);
  return () => m?.removeEventListener?.('change', notify);
};
const useCompact = () =>
  useSyncExternalStore(
    subscribe,
    () => window.matchMedia?.(QUERY).matches ?? false,
    () => false,
  );

/** Chats, refreshed every few seconds and when the tab is focused again. */
function useChats(): ChatSummary[] {
  const api = useApi();
  const [chats, setChats] = useState<ChatSummary[]>([]);
  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .listChats()
        .then((c) => live && setChats(c))
        .catch(() => {}); // the dock stays calm when the server is away
    load();
    const timer = window.setInterval(load, 5000);
    window.addEventListener('focus', load);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', load);
    };
  }, [api]);
  return chats;
}

const pill =
  'cursor-pointer rounded-full border-0 px-3 py-1 text-[13px] leading-6 font-medium whitespace-nowrap no-underline transition-[background-color,color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]';
const idle = 'bg-transparent text-muted hover:text-text';
const active = 'bg-text text-bg';

/** The floating dock at the top centre: the Mind, the places, History and New chat. */
export function Dock({ path }: { path: string }) {
  const chats = useChats();
  const [ids] = useSetting('dock');
  const items = dockItems(ids.length ? ids : DEFAULTS.dock);
  const compact = useCompact();
  const [history, setHistory] = useState(false);
  const [menu, setMenu] = useState(false);
  const sheet = useRef<HTMLDialogElement>(null);
  const current = items.find((i) => i.match(path)) ?? DOCK_ITEMS.find((i) => i.match(path));
  const mind = mindOf(chats);

  // The menu sheet is a modal dialog: focus is trapped, Escape closes it.
  useEffect(() => {
    const d = sheet.current;
    if (!d) return;
    if (menu && !d.open) d.showModal();
    if (!menu && d.open) d.close();
  }, [menu]);
  // Going somewhere closes the sheet.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every navigation
  useEffect(() => setMenu(false), [path]);

  const openHistory = useCallback(() => {
    setMenu(false);
    setHistory(true);
  }, []);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed top-3 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-edge bg-surface p-1 font-sans"
      >
        <span className="flex pr-1 pl-0.5">
          <MindGlyph state={mind} size={28} />
        </span>
        {compact ? (
          <>
            <span className="px-2 text-[13px] leading-6 font-medium text-text">
              {current?.label ?? 'Remy'}
            </span>
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
              className={`${pill} ${idle}`}
            >
              Menu
            </button>
            <dialog
              ref={sheet}
              aria-label="Menu"
              onClose={() => setMenu(false)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setMenu(false);
                }
              }}
              className="dock-sheet m-0 mx-auto mt-16 w-[min(360px,calc(100vw-32px))] rounded-[16px] border border-edge bg-surface p-2 text-text backdrop:bg-black/60"
            >
              {menu && (
                <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                  {items.map((item) => (
                    <li key={item.id}>
                      <a
                        href={item.href}
                        aria-current={item === current ? 'page' : undefined}
                        className={`${pill} block px-4 py-2.5 text-[15px] ${item === current ? active : idle}`}
                      >
                        {item.label}
                      </a>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={openHistory}
                      className={`${pill} ${idle} block w-full px-4 py-2.5 text-left text-[15px]`}
                    >
                      History
                    </button>
                  </li>
                  <li>
                    <a href="#/" className={`${pill} ${idle} block px-4 py-2.5 text-[15px]`}>
                      New chat
                    </a>
                  </li>
                </ul>
              )}
            </dialog>
          </>
        ) : (
          <>
            <ul className="m-0 flex list-none items-center gap-0.5 p-0">
              {items.map((item) => {
                const on = item === current;
                return (
                  <li key={item.id}>
                    <a
                      href={item.href}
                      aria-current={on ? 'page' : undefined}
                      className={`${pill} inline-block ${on ? active : idle}`}
                    >
                      {item.label}
                    </a>
                  </li>
                );
              })}
            </ul>
            <span aria-hidden="true" className="mx-1 h-4 w-px bg-edge-hi" />
            <button type="button" onClick={openHistory} className={`${pill} ${idle}`}>
              History
            </button>
            <a
              href="#/"
              aria-label="New chat"
              title="New chat"
              className={`${pill} ${idle} flex items-center`}
            >
              <Icon name="plus" />
            </a>
          </>
        )}
      </nav>
      <HistoryDrawer open={history} onClose={() => setHistory(false)} />
    </>
  );
}
