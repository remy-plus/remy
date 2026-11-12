// Search and browsing: which service answers Remy's web searches, a choice of service, and a test
// for each one with a key. A key is saved from the terminal into this computer's Keychain; this page
// never asks for one and the server never returns one.
import { useCallback, useEffect, useId, useState } from 'react';
import {
  type SearchService,
  type SearchStatus,
  type SearchTestResult,
  useApi,
} from '../../api/index.tsx';
import { CopyCommand } from '../../components/CopyCommand.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
import { Unavailable } from '../connect/ui.tsx';
import { Row } from './controls.tsx';

export const SEARCH_TRUST =
  "Keys go into this computer's Keychain from the terminal. They never pass through the browser.";

const KEY_WORDS: Record<SearchService['key'], string> = {
  keychain: "Key in this Mac's Keychain",
  env: 'Key set in the environment',
  none: 'No key yet',
};

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

const OWN_ROUTES: Record<string, string> = {
  browser: "Remy's own hidden browser",
  vm: 'The container',
};

/** The one sentence on which service answers now and why. */
export function whoAnswers(s: SearchStatus): string {
  if (!s.chosen) {
    return `Web search is off. ${s.why ? `${s.why[0]?.toUpperCase()}${s.why.slice(1)}.` : 'No route works here.'}`;
  }
  const svc = s.services.find((x) => x.id === s.chosen);
  if (!svc)
    return `${OWN_ROUTES[s.chosen] ?? s.chosen} answers searches. No search service has a key.`;
  const where =
    svc.key === 'keychain'
      ? "Its key is in this Mac's Keychain."
      : svc.key === 'env'
        ? 'Its key is set in the environment.'
        : '';
  const why = s.override
    ? 'It was picked outside this page, which beats your choice here.'
    : s.prefer === svc.id
      ? 'You chose it.'
      : '';
  return [`${svc.label} answers searches.`, where, why].filter(Boolean).join(' ');
}

function TestLine({
  svc,
  busy,
  result,
  failure,
}: {
  svc: SearchService;
  busy: boolean;
  result?: SearchTestResult | undefined;
  failure?: string | undefined;
}) {
  if (busy)
    return <p role="status" className="m-0 text-[13px] text-muted">{`Asking ${svc.label}`}</p>;
  if (failure)
    return (
      <p role="status" className="m-0 text-[13px] text-text">
        {failure}
      </p>
    );
  if (!result) return null;
  if (!result.ok)
    return (
      <p role="status" className="m-0 text-[13px] text-text">
        {result.error ?? `${svc.label} answered in ${seconds(result.ms)} with no results.`}
      </p>
    );
  return (
    <div role="status" className="text-[13px] text-muted">
      <p className="m-0 text-text">{`${svc.label} answered in ${seconds(result.ms)}.`}</p>
      <ul className="m-0 mt-1 p-0">
        {result.titles.map((t) => (
          <li key={t} className="list-none">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ServiceRow({
  svc,
  canTest,
  busy,
  result,
  failure,
  onTest,
}: {
  svc: SearchService;
  canTest: boolean;
  busy: boolean;
  result?: SearchTestResult | undefined;
  failure?: string | undefined;
  onTest: () => void;
}) {
  const has = svc.key !== 'none';
  const command = `remy search key ${svc.id}`;
  return (
    <li className="list-none border-b border-edge py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-60">
          <h4 className="m-0 text-[15px] font-medium">{svc.label}</h4>
          {svc.note && <p className="mt-1 mb-0 text-[14px] text-muted">{svc.note}</p>}
        </div>
        <span className="text-[13px] text-muted">{KEY_WORDS[svc.key]}</span>
        {has && canTest && (
          <button
            type="button"
            className={`${buttonQuiet} py-2.5`}
            disabled={busy}
            aria-label={`Test ${svc.label}`}
            onClick={onTest}
          >
            Test
          </button>
        )}
      </div>
      {!has && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px] text-muted">
          {svc.id === 'searxng' ? (
            <span>
              Set <code className="font-mono text-text">SEARXNG_URL</code> on the machine that runs
              Remy.
            </span>
          ) : (
            <>
              <span>
                To add a key, run <code className="font-mono text-text">{command}</code> in the
                terminal.
              </span>
              <CopyCommand command={command} title={`${svc.label} key`} />
            </>
          )}
        </div>
      )}
      <div className="mt-3 empty:hidden">
        <TestLine svc={svc} busy={busy} result={result} failure={failure} />
      </div>
    </li>
  );
}

const GROUPS: { kind: SearchService['kind']; title: string; help?: string }[] = [
  { kind: 'search', title: 'Search services' },
  {
    kind: 'reader',
    title: 'Page readers',
    help: 'Read the text of a page that a plain request cannot get.',
  },
  {
    kind: 'browser',
    title: 'Remote browsers',
    help: 'A browser that runs elsewhere, for sites that block this computer.',
  },
];

export function SearchSection() {
  const api = useApi();
  const radio = useId();
  const [status, setStatus] = useState<SearchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, SearchTestResult>>({});
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is the reload counter
  useEffect(() => {
    let live = true;
    if (!api.searchStatus) {
      setError(
        'This version of Remy does not report how it searches. Run remy search in the terminal to see it.',
      );
      return;
    }
    api.searchStatus().then(
      (s) => {
        if (!live) return;
        setStatus(s);
        setError(null);
      },
      (e: unknown) => {
        if (!live) return;
        setError(
          describeError(
            e,
            'Remy could not read how it searches. Check that it is running, then try again.',
          ),
        );
      },
    );
    return () => {
      live = false;
    };
  }, [api, n]);

  if (!status)
    return error ? (
      <Unavailable message={error} onRetry={reload} />
    ) : (
      <Skeleton label="Loading how Remy searches" lines={4} />
    );

  const keyed = status.services.filter((s) => s.kind === 'search' && s.key !== 'none');
  const prefer = status.prefer ?? 'auto';

  const choose = async (next: string) => {
    if (!api.setSearchPrefer) return;
    setSaving(true);
    setNote('');
    try {
      setStatus(await api.setSearchPrefer(next));
      setNote('Saved. New searches use this.');
    } catch (e) {
      setNote(describeError(e, 'That did not save. Check that Remy is running, then try again.'));
    } finally {
      setSaving(false);
    }
  };

  const test = async (svc: SearchService) => {
    if (!api.testSearchService) return;
    setTesting(svc.id);
    setFailures(({ [svc.id]: _drop, ...rest }) => rest);
    try {
      const r = await api.testSearchService(svc.id);
      setResults((x) => ({ ...x, [svc.id]: r }));
    } catch (e) {
      setFailures((x) => ({
        ...x,
        [svc.id]: describeError(
          e,
          `The test did not run. Check that Remy is running, then try again.`,
        ),
      }));
    } finally {
      setTesting(null);
    }
  };

  const options = [
    { id: 'auto', label: 'Automatic', help: 'The first service with a key.' },
  ].concat(keyed.map((s) => ({ id: s.id, label: s.label, help: '' })));

  return (
    <>
      <p role="status" className="mt-0 mb-2 max-w-[620px] text-[16px]">
        {whoAnswers(status)}
      </p>
      {!status.chosen && status.step && (
        <p className="mt-0 mb-2 max-w-[620px] text-[14px] text-muted">{`Next step: ${status.step}`}</p>
      )}
      <p className="mt-0 mb-6 max-w-[620px] text-[13px] text-muted">{SEARCH_TRUST}</p>

      <Row
        id="search-choice"
        title="Which one Remy uses"
        help="Automatic tries each service that has a key, in order. Pick one to use it first."
      >
        <fieldset className="m-0 border-0 p-0" disabled={saving || !api.setSearchPrefer}>
          <legend className="sr-only">Search service</legend>
          <div className="grid gap-2">
            {options.map((o) => (
              <label key={o.id} className="flex cursor-pointer items-center gap-3 text-[15px]">
                <input
                  type="radio"
                  name={radio}
                  value={o.id}
                  checked={prefer === o.id}
                  onChange={() => choose(o.id)}
                />
                <span>
                  {o.label}
                  {o.help && <span className="ml-2 text-[13px] text-muted">{o.help}</span>}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {keyed.length === 0 && (
          <p className="mt-3 mb-0 text-[13px] text-muted">
            No search service has a key yet, so there is nothing to choose between.
          </p>
        )}
        {status.override && (
          <p className="mt-3 mb-0 text-[13px] text-muted">
            {`The setting REMY_SEARCH is "${status.override}" on this machine. It beats this choice until it is unset.`}
          </p>
        )}
        <p role="status" className="mt-3 mb-0 min-h-5 text-[13px] text-muted">
          {saving ? 'Saving your choice' : note}
        </p>
      </Row>

      {GROUPS.map((g) => {
        const list = status.services.filter((s) => s.kind === g.kind);
        if (list.length === 0) return null;
        return (
          <section key={g.kind} aria-label={g.title} className="mt-8">
            <h3 className="font-mono m-0 mb-1 text-[12px] font-normal text-muted">{g.title}</h3>
            {g.help && <p className="mt-0 mb-3 max-w-[560px] text-[13px] text-muted">{g.help}</p>}
            <ul className="m-0 border-t border-edge p-0">
              {list.map((s) => (
                <ServiceRow
                  key={s.id}
                  svc={s}
                  canTest={s.kind === 'search' && Boolean(api.testSearchService)}
                  busy={testing === s.id}
                  result={results[s.id]}
                  failure={failures[s.id]}
                  onTest={() => test(s)}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
