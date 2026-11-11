import { type FormEvent, useId, useState } from 'react';
import type { CatalogApp, PermissionLevel } from '../../api/index.tsx';
import { describeError } from '../../lib/errors.ts';
import {
  AppLogo,
  field,
  Loading,
  mono,
  Notice,
  Page,
  primary,
  quiet,
  Unavailable,
  useLoad,
} from './ui.tsx';

const FALLBACK = 'That did not work. Check that Remy is still running, then try again.';
const empty = 'rounded-[10px] border border-edge bg-surface px-4 py-5';
const chip = `${mono} cursor-pointer rounded-full border border-edge bg-transparent px-3 py-1.5 text-[12px] whitespace-nowrap text-muted hover:text-text`;

export function AddConnection() {
  const { api, data, error, reload } = useLoad((a) => a.appCatalog());
  const [picked, setPicked] = useState('');
  const [level, setLevel] = useState<PermissionLevel>('draft');
  const [query, setQuery] = useState('');
  const [problem, setProblem] = useState('');
  const [connected, setConnected] = useState<{ id: string; name: string; level: string } | null>(
    null,
  );
  const groupId = useId();
  if (error) return <Unavailable message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading the apps you can connect" />;

  const shown = data.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));
  const app: CatalogApp | undefined = data.find((a) => a.id === (picked || data[0]?.id));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!app) return;
    setProblem('');
    try {
      await api.connectApp(app.id, level);
      setConnected({
        id: app.id,
        name: app.name,
        level: app.levels.find((l) => l.id === level)?.label ?? level,
      });
    } catch (err) {
      setProblem(describeError(err, FALLBACK));
    }
  };

  return (
    <Page
      crumb="Add a connection"
      title="What should Remy reach?"
      lead="Pick an app, then choose what Remy may do in it."
      aside={
        connected ? (
          <div role="status">
            <div className="mb-5 flex items-center gap-3">
              <AppLogo id={connected.id} size={32} />
              <h2 className="m-0 text-[22px] font-normal leading-tight">
                {connected.name} is connected.
              </h2>
            </div>
            <p className="mt-0 mb-5 text-[14px] leading-relaxed text-muted">
              What Remy may do there:{' '}
              <strong className="font-semibold text-text">{connected.level}</strong>. You can change
              that, or disconnect, at any time.
            </p>
            <div className="flex flex-wrap gap-2">
              <a className={primary} href="#/connections">
                See your connections
              </a>
              <button
                type="button"
                className={quiet}
                onClick={() => {
                  setConnected(null);
                  setPicked('');
                  setLevel('draft');
                }}
              >
                Connect another app
              </button>
            </div>
          </div>
        ) : (
          app && (
            <form onSubmit={submit} aria-label={`Connect ${app.name}`}>
              <div className="mb-5 flex items-center gap-3">
                <AppLogo id={app.id} size={32} />
                <div>
                  <h2 className="m-0 text-[22px] font-normal leading-tight">Connect {app.name}</h2>
                  <p className="m-0 text-[14px] text-muted">
                    You will sign in on {app.name}’s own page.
                  </p>
                </div>
              </div>
              <div role="radiogroup" aria-labelledby={`${groupId}-label`}>
                <p id={`${groupId}-label`} className={`${mono} m-0 mb-3 text-[12px] text-muted`}>
                  What may Remy do?
                </p>
                <div className="grid gap-3">
                  {app.levels.map((l) => (
                    <label
                      key={l.id}
                      className="flex cursor-pointer items-start gap-3 rounded-[10px] border border-edge bg-surface px-4 py-3 has-[:checked]:border-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-text"
                    >
                      <input
                        type="radio"
                        name={`level-${groupId}`}
                        value={l.id}
                        checked={level === l.id}
                        onChange={() => setLevel(l.id)}
                        className="mt-1 size-4 shrink-0 accent-signal"
                      />
                      <span>
                        <span className="block text-[15px] font-medium">{l.label}</span>
                        <span className="block text-[14px] leading-relaxed text-muted">
                          {l.detail}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
              <p className="mt-5 mb-5 rounded-[10px] border border-edge px-4 py-3 text-[14px] leading-relaxed text-muted">
                Remy never gets your password. You can disconnect at any time and the access ends at
                once.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className={primary}>
                  Connect {app.name}
                </button>
                <a href="#/connections" className={quiet}>
                  Cancel
                </a>
              </div>
              <div className="mt-3">
                <Notice>{problem}</Notice>
              </div>
            </form>
          )
        )
      }
    >
      {data.length === 0 ? (
        <div className={empty}>
          <p className="m-0 text-[15px]">There are no apps to connect yet.</p>
          <p className="mt-1 mb-4 max-w-[520px] text-[14px] leading-relaxed text-muted">
            Remy reads this list from its own settings. Add an app in the terminal with{' '}
            <code className={`${mono} text-[13px]`}>remy connect</code>, then reload this page.
          </p>
          <a className={quiet} href="#/connections">
            Back to connections
          </a>
        </div>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <label htmlFor="app-search" className="sr-only">
              Search apps
            </label>
            <input
              id="app-search"
              type="search"
              className={`${field} min-w-[200px] flex-1`}
              placeholder="Search apps"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query.trim() !== '' && (
              <button type="button" className={chip} onClick={() => setQuery('')}>
                Clear
              </button>
            )}
          </div>
          <div
            role="radiogroup"
            aria-label="App"
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
          >
            {shown.map((a) => (
              <label
                key={a.id}
                className="flex cursor-pointer items-center gap-3 rounded-[10px] border border-edge bg-surface px-4 py-4 has-[:checked]:border-text has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-text"
              >
                <input
                  type="radio"
                  name="app"
                  value={a.id}
                  checked={app?.id === a.id}
                  onChange={() => {
                    setPicked(a.id);
                    setConnected(null);
                    setProblem('');
                  }}
                  className="sr-only"
                />
                <AppLogo id={a.id} />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2 text-[16px] font-medium">
                    {a.name}
                    {a.spendsMoney && (
                      <span
                        className={`${mono} rounded-[4px] border border-edge bg-raise px-1.5 py-px text-[11px] font-normal text-muted`}
                      >
                        Can spend money
                      </span>
                    )}
                  </span>
                  <span className="block text-[14px] text-muted">{a.blurb}</span>
                </span>
              </label>
            ))}
          </div>
          {shown.length === 0 && (
            <div className={empty}>
              <p className="m-0 text-[15px]">No app matches “{query}”.</p>
              <p className="mt-1 mb-4 text-[14px] text-muted">Try another word, or see them all.</p>
              <button type="button" className={quiet} onClick={() => setQuery('')}>
                Clear the search
              </button>
            </div>
          )}
          <div className="mt-5 rounded-[10px] border border-dashed border-edge-hi px-4 py-4">
            <h2 className="m-0 text-[16px] font-medium">Something else?</h2>
            <p className="m-0 mt-1 max-w-[560px] text-[14px] leading-relaxed text-muted">
              Adding an app by its own address is not available in the app yet. Do it in the
              terminal with{' '}
              <code className={`${mono} text-[13px]`}>
                remy connect add &lt;name&gt; --url &lt;address&gt;
              </code>
              , then reload this page.
            </p>
          </div>
        </>
      )}
    </Page>
  );
}
