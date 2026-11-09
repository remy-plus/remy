import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import type { BrainData, BrainNote, NoteKind } from '../../api/index.tsx';
import {
  Eyebrow,
  field,
  Loading,
  mono,
  Notice,
  primary,
  quiet,
  Unavailable,
  useLoad,
} from './ui.tsx';

type Filter = 'all' | NoteKind;
const KIND_LABEL: Record<NoteKind, string> = {
  person: 'Person',
  project: 'Project',
  'how-to': 'How-to',
  fact: 'Fact',
};

/** Both directions: a link written on either note joins the two. */
function neighbours(notes: BrainNote[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>(notes.map((n) => [n.id, new Set()]));
  for (const n of notes)
    for (const to of n.links)
      if (map.has(to)) {
        map.get(n.id)?.add(to);
        map.get(to)?.add(n.id);
      }
  return map;
}

/** Which side a label sits on: right of the dot, or left of it near the edge (on a phone, from the middle). */
const side = (x: number, on: boolean) =>
  x > 84
    ? 'right-full mr-1'
    : x > 56
      ? 'right-full mr-1 sm:right-auto sm:left-full sm:mr-0 sm:ml-1'
      : on
        ? 'left-full ml-3'
        : 'left-full ml-1';

// The aspect of the graph box, so a step across and a step down compare fairly.
const ASPECT = 930 / 728;

/** Of the linked notes, the one most nearly in the direction of the arrow key, or none. */
export function nextLinked(
  from: BrainNote,
  linked: BrainNote[],
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
): BrainNote | undefined {
  const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  let best: BrainNote | undefined;
  let bestScore = 0.35; // at least about 70 degrees of the right way
  for (const n of linked) {
    const dx = (n.x - from.x) * ASPECT;
    const dy = n.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const score = (dx * (dir[0] ?? 0) + dy * (dir[1] ?? 0)) / len;
    if (score > bestScore) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

export function Brain() {
  const { api, data, setData, error } = useLoad((a) => a.brain());
  const [pick, setPick] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [said, setSaid] = useState('');
  const nodes = useRef(new Map<string, HTMLButtonElement>());

  const links = useMemo(() => neighbours(data?.notes ?? []), [data]);
  if (error) return <Unavailable message={error} />;
  if (!data) return <Loading />;

  const q = query.trim().toLowerCase();
  const visible = data.notes.filter(
    (n) =>
      (filter === 'all' || n.kind === filter) &&
      (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q)),
  );
  const shown = new Set(visible.map((n) => n.id));
  const byId = new Map(data.notes.map((n) => [n.id, n]));
  const selected = visible.find((n) => n.id === (pick ?? data.selected)) ?? visible[0];
  const around = selected ? links.get(selected.id) : undefined;
  const select = (id: string) => {
    setPick(id);
    setEditing(null);
    setConfirming(false);
    setSaid('');
  };
  const fail = (e: unknown) =>
    setSaid(
      e instanceof Error
        ? e.message
        : 'That did not work. Check that Remy is still running, then try again.',
    );
  const refresh = async (d?: BrainData) => setData(d ?? (await api.brain()));

  const edges = data.notes.flatMap((n) =>
    n.links
      .filter((to) => byId.has(to) && shown.has(n.id) && shown.has(to))
      .map((to) => ({ a: n, b: byId.get(to) as BrainNote })),
  );

  const onKey = (e: KeyboardEvent, n: BrainNote) => {
    if (!e.key.startsWith('Arrow')) return;
    const linked = [...(links.get(n.id) ?? [])]
      .map((id) => byId.get(id))
      .filter((x): x is BrainNote => !!x && shown.has(x.id));
    const to = nextLinked(n, linked, e.key as 'ArrowLeft');
    e.preventDefault();
    if (to) nodes.current.get(to.id)?.focus();
  };

  const chips: { id: Filter; label: string; n: number }[] = [
    { id: 'all', label: 'All', n: data.total },
    { id: 'person', label: 'People', n: data.counts.person },
    { id: 'project', label: 'Projects', n: data.counts.project },
    { id: 'how-to', label: 'How-tos', n: data.counts['how-to'] },
  ];

  return (
    <div className="grid min-h-[calc(100vh-66px)] lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 px-5 py-6 sm:px-8 lg:pl-14 lg:pr-8">
        <h1 className="sr-only">Brain</h1>
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <label htmlFor="brain-search" className="sr-only">
            Search notes
          </label>
          <input
            id="brain-search"
            type="search"
            className={`${field} min-w-[200px] flex-1 py-2! text-[14px]`}
            placeholder="Search by meaning: “who handles the audit?”"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
            <legend className="sr-only">Show</legend>
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={filter === c.id}
                onClick={() => setFilter(c.id)}
                className={`${mono} cursor-pointer rounded-full border px-3 py-1.5 text-[12px] whitespace-nowrap ${filter === c.id ? 'border-text bg-raise text-text' : 'border-line bg-transparent text-muted hover:text-text'}`}
              >
                {c.label} {c.n.toLocaleString('en')}
              </button>
            ))}
          </fieldset>
        </div>

        <div className="relative aspect-[4/5] overflow-hidden rounded-[14px] border border-line bg-surface sm:aspect-[930/728]">
          <svg
            aria-hidden="true"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 size-full"
          >
            {edges.map(({ a, b }) => {
              const hot = selected && (a.id === selected.id || b.id === selected.id);
              return (
                <line
                  key={`${a.id}-${b.id}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  vectorEffect="non-scaling-stroke"
                  stroke={hot ? '#a8c49a' : '#3a3a3f'}
                  strokeWidth={hot ? 1.6 : 1}
                />
              );
            })}
          </svg>
          {visible.map((n) => {
            const on = n.id === selected?.id;
            const near = !!selected && !!links.get(selected.id)?.has(n.id);
            return (
              <button
                key={n.id}
                type="button"
                ref={(el) => {
                  if (el) nodes.current.set(n.id, el);
                  else nodes.current.delete(n.id);
                }}
                aria-label={`${n.title}, ${KIND_LABEL[n.kind]}, ${n.linkCount} links`}
                aria-pressed={on}
                onClick={() => select(n.id)}
                onKeyDown={(e) => onKey(e, n)}
                style={{ left: `${n.x}%`, top: `${n.y}%` }}
                className="absolute grid size-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center border-0 bg-transparent p-0"
              >
                <Marker kind={n.kind} on={on} />
                <span
                  aria-hidden="true"
                  className={`${mono} pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[11px] [text-shadow:0_0_4px_var(--surface),0_0_4px_var(--surface)] ${side(n.x, on)} ${on ? 'text-[13px] text-text max-sm:max-w-[130px] max-sm:truncate' : near ? 'text-text max-sm:max-w-[130px] max-sm:truncate' : 'max-w-[170px] truncate text-muted'} ${on ? 'block' : near ? 'hidden min-[380px]:block' : 'hidden sm:block'}`}
                >
                  {n.title}
                </span>
              </button>
            );
          })}
          {visible.length === 0 && (
            <p
              role="status"
              className="absolute inset-0 m-0 grid place-items-center text-[14px] text-muted"
            >
              No note matches.
            </p>
          )}
          <p
            className={`${mono} pointer-events-none absolute bottom-3 left-4 m-0 flex max-sm:bottom-9 flex-wrap gap-x-4 text-[12px] text-muted`}
            aria-hidden="true"
          >
            <span>● person</span>
            <span>○ project</span>
            <span>◇ how-to</span>
            <span>· fact</span>
          </p>
          <p
            className={`${mono} pointer-events-none absolute right-4 bottom-3 m-0 text-[12px] text-muted`}
          >
            {visible.length} of {data.total.toLocaleString('en')} notes shown
          </p>
        </div>
        <p className="mt-3 mb-0 text-[13px] text-muted">
          Select a note, then use the arrow keys to move to a note it links to.
        </p>
      </div>

      <aside
        aria-label="Selected note"
        className="min-w-0 border-t border-line px-5 py-8 sm:px-8 lg:border-t-0 lg:border-l"
      >
        {selected ? (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <Eyebrow>{KIND_LABEL[selected.kind]} · selected</Eyebrow>
              <span className={`${mono} text-[12px] text-muted`}>{selected.linkCount} links</span>
            </div>
            <h2 className="mt-3 mb-3 text-[28px] font-normal leading-tight">{selected.title}</h2>
            {editing === selected.id ? (
              <EditNote
                note={selected}
                onCancel={() => setEditing(null)}
                onSave={(body) =>
                  api.updateNote(selected.id, body).then(async () => {
                    setEditing(null);
                    setSaid('Note saved.');
                    await refresh();
                  }, fail)
                }
              />
            ) : (
              <p className="m-0 mb-5 text-[16px] leading-relaxed">{selected.body}</p>
            )}
            {editing !== selected.id && (
              <div className="mb-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={primary}
                  onClick={() =>
                    api.startTask(`What do I know about ${selected.title}?`).then((r) => {
                      window.location.hash = `#/tasks/${r.taskId}`;
                    }, fail)
                  }
                >
                  Ask about {selected.title.split(' ')[0]}
                </button>
                <button type="button" className={quiet} onClick={() => setEditing(selected.id)}>
                  Edit
                </button>
                {confirming ? (
                  <>
                    <button
                      type="button"
                      className={quiet}
                      onClick={() =>
                        api.deleteNote(selected.id).then(async () => {
                          setConfirming(false);
                          setPick(null);
                          setSaid(`Deleted “${selected.title}”.`);
                          await refresh();
                        }, fail)
                      }
                    >
                      Yes, delete it
                    </button>
                    <button type="button" className={quiet} onClick={() => setConfirming(false)}>
                      Keep it
                    </button>
                  </>
                ) : (
                  <button type="button" className={quiet} onClick={() => setConfirming(true)}>
                    Delete note
                  </button>
                )}
              </div>
            )}
            {confirming && (
              <p role="alert" className="mt-0 mb-5 text-[14px] text-muted">
                Delete “{selected.title}”? Remy forgets it for good.
              </p>
            )}

            {around && around.size > 0 && (
              <section aria-labelledby="linked-h" className="mb-6">
                <Eyebrow id="linked-h">Linked to</Eyebrow>
                <ul className="m-0 mt-2 list-none p-0">
                  {[...around].map((id) => {
                    const n = byId.get(id);
                    return n ? (
                      <li key={id} className="border-b border-line last:border-b-0">
                        <button
                          type="button"
                          onClick={() => {
                            select(id);
                            setFilter('all');
                            setQuery('');
                          }}
                          className="flex w-full cursor-pointer items-baseline justify-between gap-3 border-0 bg-transparent px-0 py-3 text-left text-[15px] text-text"
                        >
                          <span>{n.title}</span>
                          <span className={`${mono} shrink-0 text-[12px] text-muted`}>
                            {n.kind} · {n.linkCount}
                          </span>
                        </button>
                      </li>
                    ) : null;
                  })}
                </ul>
              </section>
            )}
            <section aria-labelledby="from-h">
              <Eyebrow id="from-h">Where it came from</Eyebrow>
              <p
                className={`${mono} mt-2 mb-0 rounded-[10px] border border-line px-4 py-3 text-[12px] leading-relaxed text-muted`}
              >
                {selected.origin}
              </p>
            </section>
            <div className="mt-3">
              <Notice>{said}</Notice>
            </div>
          </div>
        ) : (
          <>
            <p className="m-0 text-[14px] text-muted">No note is selected.</p>
            <Notice>{said}</Notice>
          </>
        )}
      </aside>
    </div>
  );
}

function Marker({ kind, on }: { kind: NoteKind; on: boolean }) {
  if (on)
    return (
      <span
        aria-hidden="true"
        className="size-[22px] rounded-full bg-signal ring-1 ring-signal ring-offset-4 ring-offset-surface"
      />
    );
  const cls: Record<NoteKind, string> = {
    person: 'size-3 rounded-full bg-text',
    project: 'size-4 rounded-full border-2 border-text bg-bg',
    'how-to': 'size-3 rotate-45 border border-text bg-bg',
    fact: 'size-2.5 rounded-full bg-stone',
  };
  return <span aria-hidden="true" className={cls[kind]} />;
}

function EditNote({
  note,
  onSave,
  onCancel,
}: {
  note: BrainNote;
  onSave: (body: string) => void;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(note.body);
  return (
    <form
      className="mb-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) onSave(body.trim());
      }}
    >
      <label htmlFor="note-body" className="sr-only">
        Note text
      </label>
      <textarea
        id="note-body"
        rows={4}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className={field}
        aria-invalid={body.trim() ? undefined : true}
      />
      <div className="mt-3 flex gap-2">
        <button type="submit" className={primary}>
          Save note
        </button>
        <button type="button" className={quiet} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
