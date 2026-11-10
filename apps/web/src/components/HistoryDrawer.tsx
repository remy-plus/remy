import { useCallback, useEffect, useRef, useState } from 'react';
import { type ChatSummary, useApi } from '../api/index.tsx';
import { describeError } from '../lib/errors.ts';
import { ago, group } from '../lib/when.ts';
import { Confirm } from './Confirm.tsx';
import { buttonPrimary, field } from './ui.ts';

const ORDER = ['Today', 'Yesterday', 'This week', 'Earlier'];

const small =
  'cursor-pointer rounded-full border-0 bg-transparent px-2.5 py-1 text-[13px] text-muted hover:text-text';

/** A slide-over from the left that lists chats: open one, rename it, delete it. */
export function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useApi();
  const ref = useRef<HTMLDialogElement>(null);
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [doomed, setDoomed] = useState<ChatSummary | null>(null);

  const load = useCallback(
    () =>
      api
        .listChats()
        .then((c) => {
          setChats(c);
          setError('');
        })
        .catch((e: unknown) => setError(describeError(e, 'Remy could not load your chats.'))),
    [api],
  );

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      void load();
    }
    if (!open && d.open) d.close();
  }, [open, load]);

  const rename = async (c: ChatSummary) => {
    const title = draft.trim();
    setEditing(null);
    if (!title || title === c.title) return;
    try {
      await api.renameChat(c.id, title);
    } catch (e) {
      setError(describeError(e, 'That name was not saved. Try again.'));
    }
    void load();
  };
  const remove = async () => {
    const c = doomed;
    setDoomed(null);
    if (!c) return;
    try {
      await api.deleteChat(c.id);
    } catch (e) {
      setError(describeError(e, 'That chat was not deleted. Try again.'));
    }
    void load();
  };

  const now = new Date();
  const groups = ORDER.map((title) => ({
    title,
    rows: (chats ?? []).filter((c) => group(c.updatedAt, now) === title),
  })).filter((g) => g.rows.length);

  return (
    <>
      <dialog
        ref={ref}
        aria-label="History"
        onClose={onClose}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          onClose();
        }}
        onClick={(e) => {
          if (e.target === ref.current) onClose(); // the dim area beside the panel
        }}
        className="history-drawer m-0 h-full max-h-none w-[320px] max-w-full border-0 border-r border-edge-hi bg-surface p-0 text-text backdrop:bg-black/60 max-sm:w-full"
      >
        {open && (
          <div className="flex h-full flex-col font-sans">
            <div className="flex items-center justify-between gap-2 px-5 pt-5 pb-3">
              <h2 className="m-0 text-[18px] font-medium">History</h2>
              <button type="button" onClick={onClose} className={small}>
                Close
              </button>
            </div>
            <div className="px-5 pb-3">
              <button
                type="button"
                onClick={() => {
                  window.location.hash = '#/';
                  onClose();
                }}
                className={`${buttonPrimary} block w-full text-center`}
              >
                New chat
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
              {error && (
                <p role="alert" className="px-2 text-[14px] text-muted">
                  {error}
                </p>
              )}
              {chats && chats.length === 0 && !error && (
                <p className="px-2 text-[14px] text-muted">
                  No chats yet. Ask Remy something and it will show up here.
                </p>
              )}
              {groups.map((g) => (
                <section key={g.title} aria-label={g.title} className="mt-4">
                  <h3 className="m-0 px-2 pb-1 text-[13px] font-normal text-muted">{g.title}</h3>
                  <ul className="m-0 list-none p-0">
                    {g.rows.map((c) => (
                      <li key={c.id} className="rounded-[10px] hover:bg-raise">
                        {editing === c.id ? (
                          <form
                            className="p-1.5"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void rename(c);
                            }}
                          >
                            <input
                              autoFocus
                              aria-label="Chat name"
                              value={draft}
                              onChange={(e) => setDraft(e.target.value)}
                              onBlur={() => void rename(c)}
                              onKeyDown={(e) => {
                                if (e.key !== 'Escape') return;
                                e.preventDefault();
                                e.stopPropagation();
                                setEditing(null);
                              }}
                              className={`${field} w-full`}
                            />
                          </form>
                        ) : (
                          <div className="flex items-center gap-1 pr-1">
                            <a
                              href={`#/chat/${encodeURIComponent(c.id)}`}
                              onClick={onClose}
                              className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2.5 text-text no-underline"
                            >
                              <span
                                aria-hidden="true"
                                className={`size-1.5 shrink-0 rounded-full ${c.state === 'working' ? 'bg-signal' : 'bg-transparent'}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[15px] font-medium">
                                  {c.title}
                                </span>
                                <span className="block text-[12px] text-muted">
                                  {c.state === 'working' && (
                                    <span className="sr-only">Working. </span>
                                  )}
                                  {ago(c.updatedAt, now)}
                                </span>
                              </span>
                            </a>
                            <button
                              type="button"
                              aria-label={`Rename ${c.title}`}
                              className={small}
                              onClick={() => {
                                setDraft(c.title);
                                setEditing(c.id);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${c.title}`}
                              className={small}
                              onClick={() => setDoomed(c)}
                            >
                              Delete
                            </button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </div>
        )}
      </dialog>
      <Confirm
        open={!!doomed}
        title="Delete this chat?"
        confirmLabel="Delete"
        cancelLabel="Keep"
        onConfirm={() => void remove()}
        onCancel={() => setDoomed(null)}
      >
        The jobs Remy did in it stay in Activity.
      </Confirm>
    </>
  );
}
