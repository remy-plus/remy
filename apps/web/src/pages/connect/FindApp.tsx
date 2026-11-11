// The official registry, searched from the web app. Read-only: the answer names a command for the
// person to run in their terminal, where they see the exact command before anything is added.
import { useEffect, useId, useState } from 'react';
import type { RegistryApp, RegistrySearch } from '../../api/index.tsx';
import { useApi } from '../../api/index.tsx';
import { describeError } from '../../lib/errors.ts';
import { field, mono, Notice } from './ui.tsx';

const FALLBACK = 'That did not work. Check that Remy is still running, then try again.';
const MIN = 2;
const chip =
  'cursor-pointer rounded-full border border-edge bg-transparent px-3 py-1.5 text-[12px] whitespace-nowrap text-muted hover:text-text';
const badge = `${mono} rounded-[4px] border border-edge bg-raise px-1.5 py-px text-[11px] text-muted`;

/** Copies the command, or shows it when the browser will not let the page write to the clipboard. */
function CopyCommand({ command, title }: { command: string; title: string }) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  useEffect(() => {
    if (state !== 'done') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  if (state === 'failed')
    return <code className={`${mono} block text-[12px] break-all text-muted`}>{command}</code>;
  return (
    <button
      type="button"
      className={chip}
      aria-label={`Copy the command to add ${title}`}
      onClick={() => {
        navigator.clipboard
          .writeText(command)
          .then(() => setState('done'))
          .catch(() => setState('failed'));
      }}
    >
      {state === 'done' ? 'Copied' : 'Copy command'}
    </button>
  );
}

function Row({ app }: { app: RegistryApp }) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 border-t border-edge px-4 py-3.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[15px] font-medium">{app.title}</span>
          <span className={badge}>{app.kind === 'remote' ? 'Hosted' : 'Runs here'}</span>
          {app.version && <span className={`${mono} text-[11px] text-muted`}>{app.version}</span>}
        </div>
        {app.description && (
          <p className="m-0 mt-0.5 text-[13.5px] leading-relaxed text-muted">{app.description}</p>
        )}
        <p className={`${mono} m-0 mt-1.5 text-[12px] break-all text-muted`}>{app.where}</p>
      </div>
      <CopyCommand command={app.command} title={app.title} />
    </li>
  );
}

export function FindApp() {
  const api = useApi();
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<RegistrySearch | null>(null);
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState('');
  const id = useId();
  const words = query.trim();

  useEffect(() => {
    if (words.length < MIN) {
      setFound(null);
      setFinding(false);
      setProblem('');
      return;
    }
    let live = true;
    setFinding(true);
    setProblem('');
    const t = setTimeout(() => {
      api
        .searchApps(words)
        .then((r) => {
          if (!live) return;
          setFound(r);
          setFinding(false);
        })
        .catch((e: unknown) => {
          if (!live) return;
          setFound(null);
          setFinding(false);
          setProblem(describeError(e, FALLBACK));
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [words, api]);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="mt-6 rounded-[12px] border border-edge bg-surface"
    >
      <div className="px-4 pt-4 pb-3">
        <h2 id={`${id}-title`} className="m-0 text-[16px] font-medium">
          Find any app
        </h2>
        <p className="m-0 mt-1 max-w-[560px] text-[14px] leading-relaxed text-muted">
          Search the official registry. It has thousands of apps, so the one you want is probably
          there even when it is not above.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-search`} className="sr-only">
            Search the official registry
          </label>
          <input
            id={`${id}-search`}
            type="search"
            className={`${field} min-w-[220px] flex-1`}
            placeholder="Notion, Postgres, Stripe…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {finding && (
            <span role="status" className="text-[13px] text-muted">
              Searching…
            </span>
          )}
        </div>
      </div>
      {words.length < MIN ? (
        <p className="m-0 border-t border-edge px-4 py-3.5 text-[13.5px] text-muted">
          Type at least {MIN} letters.
        </p>
      ) : problem ? (
        <div className="border-t border-edge px-4 py-3.5">
          <Notice>{problem}</Notice>
        </div>
      ) : found && found.apps.length === 0 ? (
        <p className="m-0 border-t border-edge px-4 py-3.5 text-[13.5px] text-muted">
          Nothing in the official registry matches “{words}”.
        </p>
      ) : found ? (
        <>
          <ul className="m-0 list-none border-t border-edge p-0">
            {found.apps.map((a) => (
              <Row key={a.name} app={a} />
            ))}
          </ul>
          <p className="m-0 border-t border-edge px-4 py-3 text-[13px] leading-relaxed text-muted">
            {found.note}
          </p>
        </>
      ) : null}
    </section>
  );
}
