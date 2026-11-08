// Sign in to a Remy server. The token is saved in this browser only after the server has accepted it
// in a test call, so a wrong token is never stored. Nothing here sends the token anywhere but the
// address the page was loaded from.
import { type FormEvent, useEffect, useId, useState } from 'react';
import { createHttpApi } from '../../api/http.ts';
import { type Health, type RemyApi, useApi } from '../../api/index.tsx';
import { Logo } from '../../components/Logo.tsx';
import { buttonPrimary, field } from '../../components/ui.ts';
import { setSetting } from '../../settings.ts';

export const TOKEN_STORAGE_KEY = 'remy.token';

/** The mock answers when the page was opened with ?mock=1; otherwise the real server is asked. */
function probeFor(api: RemyApi): RemyApi {
  const demo = new URLSearchParams(window.location.search).get('mock') === '1';
  return api.kind === 'http' || demo ? api : createHttpApi({ token: () => null });
}

const reload = () => {
  window.location.hash = '#/';
  window.location.reload();
};

export function SignIn({
  probe,
  onSignedIn = reload,
}: {
  /** Which server to ask. Tests pass one; the page picks it otherwise. */
  probe?: RemyApi;
  onSignedIn?: () => void;
}) {
  const context = useApi();
  const [api] = useState(() => probe ?? probeFor(context));
  const id = useId();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState<Health | 'down' | null>(null);
  const [running, setRunning] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    api
      .health()
      .then((h) => live && setHealth(h))
      .catch(() => live && setHealth('down'));
    return () => {
      live = false;
    };
  }, [api]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const given = token.trim();
    if (!given) {
      setError('Enter the token first.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api.testToken(given);
      setRunning(r.running);
      try {
        window.localStorage.setItem(TOKEN_STORAGE_KEY, given); // only now that the server said yes
      } catch {
        setError('This browser would not keep the token. Allow site data, then try again.');
        return;
      }
      setSetting('onboarded', true);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const host = window.location.host || 'this server';
  const secure = window.location.protocol === 'https:';
  return (
    <div className="grid min-h-screen place-items-center bg-[radial-gradient(ellipse_at_center,#171917_0%,transparent_62%)] px-5 py-12">
      <div className="w-full max-w-[460px]">
        <Logo size="min(11px, 2.8vw)" />
        <h1 className="mt-10 mb-0 text-[28px] leading-tight font-medium tracking-tight">
          Sign in to your Remy.
        </h1>
        <p className="mt-2 mb-0 text-[16px] text-muted">
          Your assistant, anywhere. This one runs on your home server.
        </p>

        <form onSubmit={submit} noValidate className="mt-7">
          <label htmlFor={`${id}-token`} className="font-mono block text-[12px] text-muted">
            Access token
          </label>
          <input
            id={`${id}-token`}
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`${field} mt-2 block w-full py-3 ${error ? 'border-text' : ''}`}
          />
          {error && (
            <p id={`${id}-error`} role="alert" className="mt-2 mb-0 text-[14px] text-text">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy}
            className={`${buttonPrimary} mt-4 block w-full py-3.5 text-[13px]`}
          >
            Sign in
          </button>
        </form>

        <section
          aria-label="Server status"
          className="font-mono mt-6 rounded-[10px] border border-line bg-surface px-4 py-3.5 text-[12px] leading-relaxed"
        >
          <p className="m-0 flex items-center gap-2 text-text">
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${health && health !== 'down' ? 'bg-signal' : 'bg-stone'}`}
            />
            {host}
          </p>
          <p aria-live="polite" className="mt-1 mb-0 text-muted">
            {health === null && 'Checking the server'}
            {health === 'down' && 'Remy could not be reached at this address.'}
            {health && health !== 'down' && (
              <>
                Remy {health.version}
                {running !== null && ` · ${running} ${running === 1 ? 'task' : 'tasks'} running`}
              </>
            )}
          </p>
          <p className="mt-1 mb-0 text-muted">
            {secure
              ? 'The connection is encrypted.'
              : 'The connection is not encrypted. Use it only on a network you trust.'}
          </p>
        </section>

        <p className="mt-6 mb-0 text-[14px] text-muted">
          Lost it? On the server, run{' '}
          <code className="font-mono text-text">remy serve token --rotate</code>.
        </p>
      </div>
    </div>
  );
}
