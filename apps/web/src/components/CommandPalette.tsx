// The command palette: Ctrl or ⌘ + K, or the `remy:palette` window event. A native modal <dialog>
// holding a combobox and a listbox. Enter opens the chosen row; Tab tells Remy to do what was typed.
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { type TaskListItem, type TaskStatus, useApi } from '../api/index.tsx';
import { setSetting } from '../settings.ts';

interface Item {
  id: string;
  group: 'Ask your brain' | 'Tasks' | 'Do something';
  label: string;
  hint: string;
  run: () => void | Promise<void>;
  /** True when the row starts a task: it closes the palette itself once the task exists. */
  starts?: boolean;
}

const GROUPS: Item['group'][] = ['Ask your brain', 'Tasks', 'Do something'];
const STATUS: Record<TaskStatus, string> = {
  running: 'running',
  waiting_approval: 'waiting for you',
  waiting_user: 'waiting for you',
  paused: 'paused',
  succeeded: 'done',
  failed: 'failed',
  cancelled: 'stopped',
};
const SUGGESTIONS = ['What do I still owe anyone?', 'What changed since Friday?'];

const go = (hash: string) => {
  window.location.hash = hash;
};
const matches = (label: string, q: string) => {
  const l = label.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => l.includes(w));
};

export function CommandPalette() {
  const api = useApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const base = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [tasks, setTasks] = useState<TaskListItem[]>([]);
  const [error, setError] = useState('');

  const close = useCallback(() => setOpen(false), []);

  // Open from the keyboard or from a button anywhere in the app.
  useEffect(() => {
    const show = () => {
      setQuery('');
      setActive(0);
      setError('');
      setOpen(true);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (dialog.current?.open) close();
        else show();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('remy:palette', show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('remy:palette', show);
    };
  }, [close]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api
      .listTasks({ limit: 30 })
      .then((t) => live && setTasks(t))
      .catch(() => live && setTasks([]));
    return () => {
      live = false;
    };
  }, [open, api]);

  const q = query.trim();
  const start = useCallback(
    async (prompt: string) => {
      try {
        const { taskId } = await api.startTask(prompt);
        close();
        go(`#/tasks/${encodeURIComponent(taskId)}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Remy could not start that.');
      }
    },
    [api, close],
  );

  const items: Item[] = [];
  const add = (
    group: Item['group'],
    label: string,
    hint: string,
    run: Item['run'],
    starts = false,
  ) => items.push({ id: `${base}-o${items.length}`, group, label, hint, run, starts });
  if (q) add('Ask your brain', `${q}?`, 'Enter to ask', () => start(q), true);
  for (const s of SUGGESTIONS)
    if (matches(s, q) && s !== q) add('Ask your brain', s, '', () => start(s), true);
  for (const t of tasks.filter((t) => matches(t.prompt, q)).slice(0, 4))
    add('Tasks', t.prompt, STATUS[t.status], () => go(`#/tasks/${encodeURIComponent(t.id)}`));
  if (q) add('Do something', q, 'asks before sending', () => start(q), true);
  const actions: [string, string, () => void][] = [
    [
      'Turn on quiet mode',
      'only approvals get through',
      () => {
        setSetting('quiet', true);
        go('#/quiet');
      },
    ],
    ['Talk to Remy', 'push to talk', () => window.dispatchEvent(new Event('remy:voice'))],
    ['Add a connection', 'Gmail, Notion, files', () => go('#/connections/add')],
    ['Open the overnight review', '', () => go('#/review')],
    ['Open settings', '', () => go('#/settings')],
    ['Go to Home', '', () => go('#/')],
  ];
  for (const [label, hint, run] of actions)
    if (matches(label, q)) add('Do something', label, hint, run);

  const at = Math.min(active, Math.max(0, items.length - 1));
  const current = items[at];

  useEffect(() => {
    if (!open || !current) return;
    document.getElementById(current.id)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, current]);

  const choose = async (item: Item | undefined) => {
    if (!item) return;
    if (!item.starts) close();
    await item.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const n = items.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (n) setActive((at + 1) % n);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (n) setActive((at - 1 + n) % n);
        break;
      case 'Enter':
        if (e.nativeEvent.isComposing) break;
        e.preventDefault();
        void choose(current);
        break;
      case 'Tab': {
        e.preventDefault();
        const prompt = q || current?.label;
        if (prompt) void start(prompt);
        break;
      }
      case 'Escape':
        e.preventDefault();
        close();
        break;
    }
  };

  const shown = GROUPS.map((g) => ({ g, rows: items.filter((i) => i.group === g) })).filter(
    (x) => x.rows.length > 0,
  );
  const listId = `${base}-list`;
  return (
    <dialog
      ref={dialog}
      aria-label="Command palette"
      onClose={close}
      onClick={(e) => e.target === e.currentTarget && close()}
      onKeyDown={onKeyDown}
      className="mx-auto mt-[min(150px,12vh)] mb-auto w-[min(760px,calc(100vw-32px))] overflow-hidden rounded-[14px] border border-stone bg-surface p-0 text-text backdrop:bg-black/70"
    >
      {open && (
        <>
          <div className="flex items-center gap-3 border-b border-line px-5 py-4">
            <kbd className="font-mono hidden rounded border border-line bg-raise px-1.5 py-1 text-[11px] text-muted sm:block">
              ⌘K
            </kbd>
            <input
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={current?.id}
              aria-autocomplete="list"
              aria-label="Search or tell Remy what to do"
              placeholder="Search, ask, or tell Remy what to do"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setError('');
              }}
              className="min-w-0 flex-1 border-0 bg-transparent text-[18px] text-text outline-none placeholder:text-muted focus-visible:outline-none"
            />
          </div>
          <div
            id={listId}
            role="listbox"
            aria-label="Results"
            className="max-h-[min(470px,60vh)] overflow-y-auto p-2"
          >
            {shown.length === 0 && (
              <p className="m-0 px-3 py-4 text-[14px] text-muted">Nothing matches.</p>
            )}
            {shown.map(({ g, rows }) => (
              // biome-ignore lint/a11y/useSemanticElements: a listbox may only hold option groups, not a fieldset
              <div key={g} role="group" aria-labelledby={`${base}-${g}`} className="mb-2">
                <div
                  id={`${base}-${g}`}
                  className="font-mono px-3 pt-2 pb-1.5 text-[12px] text-muted"
                >
                  {g}
                </div>
                {rows.map((it) => {
                  const on = it === current;
                  return (
                    // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input owns the keyboard
                    <div
                      key={it.id}
                      id={it.id}
                      role="option"
                      aria-selected={on}
                      tabIndex={-1}
                      onMouseMove={() => setActive(items.indexOf(it))}
                      onClick={() => void choose(it)}
                      className={`flex cursor-pointer items-baseline justify-between gap-4 rounded-md px-3 py-2.5 ${on ? 'bg-raise' : ''}`}
                    >
                      <span className={`min-w-0 text-[16px] ${on ? 'text-text' : 'text-text/85'}`}>
                        {it.label}
                      </span>
                      <span className="font-mono shrink-0 text-[12px] text-muted">
                        {on && it.group === 'Ask your brain' ? 'Enter to ask' : it.hint}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          {error && (
            <p
              role="alert"
              className="font-mono m-0 border-t border-line px-5 py-3 text-[12px] text-muted"
            >
              {error}
            </p>
          )}
          <p className="font-mono m-0 flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-5 py-3 text-[12px] text-muted">
            <span>
              <Key>↑↓</Key> move
            </span>
            <span>
              <Key>Enter</Key> open
            </span>
            <span>
              <Key>Tab</Key> tell Remy to do it
            </span>
            <span>
              <Key>Esc</Key> close
            </span>
          </p>
        </>
      )}
    </dialog>
  );
}

function Key({ children }: { children: string }) {
  return (
    <kbd className="font-mono mr-1 rounded border border-line bg-raise px-1.5 py-0.5 text-[11px] text-text">
      {children}
    </kbd>
  );
}
