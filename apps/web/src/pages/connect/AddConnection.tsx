import { type FormEvent, useId, useState } from 'react';
import type { CatalogApp, PermissionLevel } from '../../api/index.tsx';
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

export function AddConnection() {
  const { api, data, error, reload } = useLoad((a) => a.appCatalog());
  const [picked, setPicked] = useState('');
  const [level, setLevel] = useState<PermissionLevel>('draft');
  const [query, setQuery] = useState('');
  const [byAddress, setByAddress] = useState(false);
  const [problem, setProblem] = useState('');
  const groupId = useId();
  if (error) return <Unavailable message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading the apps you can connect" />;

  const shown = data.filter((a) => a.name.toLowerCase().includes(query.trim().toLowerCase()));
  const app: CatalogApp | undefined = data.find((a) => a.id === (picked || data[0]?.id));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!app) return;
    try {
      await api.connectApp(app.id, level);
      window.location.hash = '#/connections';
    } catch (err) {
      setProblem(
        err instanceof Error
          ? err.message
          : 'That did not work. Check that Remy is still running, then try again.',
      );
    }
  };

  return (
    <Page
      crumb="Add a connection"
      title="What should Remy reach?"
      lead="Pick an app. You choose what Remy may do in it on the next step."
      aside={
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
                      className="mt-1 size-4 shrink-0 accent-[#a8c49a]"
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
      }
    >
      <label htmlFor="app-search" className="sr-only">
        Search apps
      </label>
      <input
        id="app-search"
        type="search"
        className={`${field} mb-5`}
        placeholder="Search apps"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
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
              onChange={() => setPicked(a.id)}
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
      {shown.length === 0 && <p className="text-[14px] text-muted">No app matches “{query}”.</p>}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[10px] border border-dashed border-edge-hi px-4 py-4">
        <div className="min-w-0 max-w-[520px]">
          <h2 className="m-0 text-[16px] font-medium">Something else?</h2>
          <p className="m-0 mt-1 text-[14px] text-muted">
            For a technical user: add a custom app by its address. It must speak MCP, a standard way
            for AI tools to connect. Remy handles it with caution until you say otherwise.
          </p>
          {byAddress && (
            <p role="status" className="mt-2 mb-0 text-[14px] text-text">
              Adding by address is not available here yet.
            </p>
          )}
        </div>
        <button type="button" className={quiet} onClick={() => setByAddress(true)}>
          Add by address
        </button>
      </div>
    </Page>
  );
}
