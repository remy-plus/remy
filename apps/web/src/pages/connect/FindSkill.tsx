// Skills from skills.sh and ready-made bots from botdirectory.ai, searched from the web app.
// Nothing is saved until the person confirms, and what is saved is text Remy reads as a guide.
import { useEffect, useId, useState } from 'react';
import type { DirectoryResult } from '../../api/index.tsx';
import { useApi } from '../../api/index.tsx';
import { BrainTabs } from '../../components/BrainTabs.tsx';
import { Confirm } from '../../components/Confirm.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { describeError } from '../../lib/errors.ts';
import { AppLogo, field, mono, Notice } from './ui.tsx';

const FALLBACK = 'That did not work. Check that Remy is still running, then try again.';
const LONG = 140;

type From = 'skills' | 'bots';
const TABS: { id: From; label: string; hint: string; where: string }[] = [
  { id: 'skills', label: 'Skills', hint: 'Type a word to search skills.sh.', where: 'skills.sh' },
  {
    id: 'bots',
    label: 'Ready-made bots',
    hint: 'Type a word to search botdirectory.ai.',
    where: 'botdirectory.ai',
  },
];

const keyOf = (r: DirectoryResult) => `${r.source}:${r.id}`;
const quiet =
  'cursor-pointer rounded-full border border-edge-hi bg-transparent px-4 py-[8px] text-[14px] font-medium text-text no-underline hover:bg-raise';
const link = 'text-text underline underline-offset-2';

function Row({
  r,
  installed,
  onInstall,
}: {
  r: DirectoryResult;
  installed: boolean;
  onInstall: () => void;
}) {
  const [open, setOpen] = useState(false);
  const long = r.description.length > LONG;
  return (
    <li className="flex flex-col gap-2 border-t border-edge px-4 py-3.5 first:border-t-0 sm:flex-row sm:items-start sm:gap-x-3.5">
      <AppLogo id={r.id} name={r.name} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="text-[15px] font-medium break-words">{r.name}</span>
          <span className={`${mono} text-[12px] text-muted`}>{r.detail}</span>
        </div>
        <p
          className={`m-0 mt-0.5 text-[13.5px] leading-relaxed break-words text-muted ${open ? '' : 'line-clamp-2'}`}
        >
          {r.description}
        </p>
        {long && (
          <button
            type="button"
            aria-expanded={open}
            className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-[13px] text-text underline"
            onClick={() => setOpen(!open)}
          >
            {open ? 'Show less' : 'Show all'}
          </button>
        )}
        <p className={`${mono} m-0 mt-1.5 text-[12px] break-all text-muted`}>
          <a className={link} href={r.url} target="_blank" rel="noreferrer">
            {r.id}
            <span className="sr-only"> on {r.source} (opens in a new tab)</span>
          </a>
        </p>
      </div>
      <div className="shrink-0 self-start">
        {installed ? (
          <span className={`${mono} text-[13px] text-signal`}>Installed</span>
        ) : (
          <button
            type="button"
            className={quiet}
            aria-label={`Install ${r.name}`}
            onClick={onInstall}
          >
            Install
          </button>
        )}
      </div>
    </li>
  );
}

export function FindSkill() {
  const api = useApi();
  const [from, setFrom] = useState<From>('skills');
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ results: DirectoryResult[]; note: string } | null>(null);
  const [finding, setFinding] = useState(false);
  const [problem, setProblem] = useState('');
  const [asking, setAsking] = useState<DirectoryResult | null>(null);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [said, setSaid] = useState<string | null>(null);
  const id = useId();
  const words = query.trim();
  const tab = TABS.find((t) => t.id === from) ?? (TABS[0] as (typeof TABS)[number]);

  useEffect(() => {
    setFound(null);
    setProblem('');
    if (!words) {
      setFinding(false);
      return;
    }
    let live = true;
    setFinding(true);
    const t = setTimeout(() => {
      api
        .searchSkillDirectory(words, from)
        .then((r) => {
          if (!live) return;
          setFound(r);
          setFinding(false);
        })
        .catch((e: unknown) => {
          if (!live) return;
          setFinding(false);
          setProblem(describeError(e, FALLBACK));
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [words, from, api]);

  const install = async () => {
    if (!asking) return;
    const skill = await api.installFromDirectory(asking.source, asking.id);
    setInstalled((s) => new Set(s).add(keyOf(asking)));
    setSaid(skill.name);
    setAsking(null);
  };

  return (
    <div className="min-w-0 px-5 py-8 sm:px-8 lg:px-14">
      <BrainTabs current="skills" />
      <p className={`${mono} m-0 mb-3 text-[12px] text-muted`}>
        <a href="#/skills" className="-my-3 inline-block py-3 text-text underline">
          Skills
        </a>{' '}
        / Find a skill
      </p>
      <h1 className="m-0 text-[30px] font-normal leading-tight">Find a skill</h1>
      <p className="mt-3 mb-6 max-w-[560px] text-base text-muted">
        Search skills that other people share, or bots they have already written. You read what you
        are adding before it is saved.
      </p>

      <section
        aria-labelledby={`${id}-title`}
        className="max-w-[860px] rounded-[12px] border border-edge bg-surface"
      >
        <div className="px-4 pt-4 pb-3">
          <h2 id={`${id}-title`} className="sr-only">
            Search {tab.where}
          </h2>
          <div role="tablist" aria-label="Where to look" className="mb-3 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === from}
                className={`cursor-pointer rounded-full border px-3.5 py-1.5 text-[14px] ${t.id === from ? 'border-text text-text' : 'border-edge bg-transparent text-muted hover:text-text'}`}
                onClick={() => setFrom(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-search`} className="sr-only">
              Search {tab.where}
            </label>
            <input
              id={`${id}-search`}
              type="search"
              className={`${field} w-full max-w-[420px] min-w-[220px] flex-1`}
              placeholder={
                from === 'skills' ? 'PDF, meeting notes, SEO…' : 'Email, invoices, support…'
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        {!words ? (
          <p className="m-0 border-t border-edge px-4 py-3.5 text-[13.5px] text-muted">
            {tab.hint}
          </p>
        ) : finding ? (
          <div className="border-t border-edge px-4 py-3.5">
            <Skeleton label={`Searching ${tab.where}`} variant="rows" lines={3} />
          </div>
        ) : problem ? (
          <div className="border-t border-edge px-4 py-3.5">
            <Notice>{problem}</Notice>
          </div>
        ) : found && found.results.length === 0 ? (
          <p className="m-0 border-t border-edge px-4 py-3.5 text-[13.5px] text-muted">
            Nothing matched “{words}”. Try a shorter word.
          </p>
        ) : found ? (
          <>
            <ul aria-label="Results" className="m-0 list-none border-t border-edge p-0">
              {found.results.map((r) => (
                <Row
                  key={keyOf(r)}
                  r={r}
                  installed={installed.has(keyOf(r))}
                  onInstall={() => setAsking(r)}
                />
              ))}
            </ul>
            <p className="m-0 border-t border-edge px-4 py-3 text-[13px] leading-relaxed text-muted">
              {found.note}
            </p>
          </>
        ) : null}
      </section>

      <div className="mt-3 max-w-[860px]" role="status">
        {said && (
          <p className={`${mono} m-0 text-[12px] text-muted`}>
            {said} is installed.{' '}
            <a className={link} href="#/skills">
              See it in Skills
            </a>
          </p>
        )}
      </div>

      <Confirm
        open={asking !== null}
        title={`Install ${asking?.name ?? ''}?`}
        confirmLabel="Install"
        cancelLabel="Not now"
        onConfirm={install}
        onCancel={() => setAsking(null)}
      >
        {asking && (
          <>
            <p className="m-0 break-words">{asking.description}</p>
            <p className="mt-2 mb-0">
              It comes from {asking.source === 'skills.sh' ? 'skills.sh' : 'botdirectory.ai'}, not
              from Remy.
            </p>
            {asking.source === 'skills.sh' ? (
              <p className="mt-2 mb-0">
                It is saved as text at a fixed version. Running it is an ordinary task: Remy asks
                before anything is sent or changed.
              </p>
            ) : (
              <>
                <p className="mt-2 mb-1">This is the start of its prompt:</p>
                <section
                  aria-label="Prompt preview"
                  className={`${mono} m-0 max-h-[180px] overflow-auto rounded-[8px] border border-edge bg-bg p-3 text-[12px] leading-relaxed whitespace-pre-wrap break-words`}
                >
                  {asking.preview ?? 'No preview was provided.'}
                </section>
                <p className="mt-2 mb-0">
                  This was written by someone else. Remy reads it as a guide, never as permission.
                </p>
              </>
            )}
          </>
        )}
      </Confirm>
    </div>
  );
}
