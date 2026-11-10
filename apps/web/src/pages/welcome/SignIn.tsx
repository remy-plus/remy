// Sign in to a Remy server. The token is saved in this browser only after the server has accepted it
// in a test call, so a wrong token is never stored. Nothing here sends the token anywhere but the
// address the page was loaded from.
import { type FormEvent, useEffect, useId, useState } from 'react';
import { createHttpApi } from '../../api/http.ts';
import { type Health, type RemyApi, useApi } from '../../api/index.tsx';
import { AsciiMark, DotField } from '../../components/AsciiMark.tsx';
import { Logo } from '../../components/Logo.tsx';
import { buttonPrimary, field } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
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
      setError(
        describeError(err, 'That did not work. Check that Remy is still running, then try again.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const host = window.location.host || 'this server';
  const secure = window.location.protocol === 'https:';
  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden px-5 py-12">
      <DotField className="absolute inset-0 h-full w-full [mask-image:radial-gradient(ellipse_52%_52%_at_50%_46%,#000_14%,transparent_76%)] [-webkit-mask-image:radial-gradient(ellipse_52%_52%_at_50%_46%,#000_14%,transparent_76%)]" />
      <div className="relative w-full max-w-[460px]">
        <AsciiMark fallback={<Logo size="min(11px, 2.8vw)" />} />
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
          <p id={`${id}-help`} className="mt-1.5 mb-0 text-[13px] leading-snug text-muted">
            Remy prints this once, when you run{' '}
            <code className="font-mono text-text">remy serve</code> on the server.
          </p>
          <input
            id={`${id}-token`}
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error ${id}-help` : `${id}-help`}
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
          className="font-mono mt-6 rounded-[10px] border border-edge bg-surface px-4 py-3.5 text-[12px] leading-relaxed"
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
            {health === 'down' &&
              'Remy could not be reached at this address. Check the address and that Remy is running.'}
            {health && health !== 'down' && (
              <>
                Remy {health.version}
                {running !== null && ` · ${running} ${running === 1 ? 'job' : 'jobs'} running`}
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
        <p className="mt-4 mb-0 border-t border-edge pt-4 text-[13px] leading-relaxed text-muted">
          Remy runs on your server. Your chats, keys and files stay there, and nothing is sent
          anywhere else.
        </p>
      </div>
    </div>
  );
}
