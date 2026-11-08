// Where `remy serve` may listen. Loopback only, unless REMY_SERVE_ALLOW_REMOTE=on is also set.
// There is no TLS here: for another machine, use a private network such as Tailscale.
import { DEFAULT_PORT, isLoopback, LOOPBACK } from './webhook-bind.ts';

export interface ServeBind {
  host: string;
  port: number;
}

/** Works out host and port, or throws a plain error when the address is not allowed. */
export function resolveServeBind(
  opts: { host?: string; port?: string },
  env: Record<string, string | undefined>,
): ServeBind {
  const host = opts.host ?? LOOPBACK;
  const port = opts.port === undefined ? DEFAULT_PORT : Number(opts.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('The port must be a number from 0 to 65535.');
  if (!isLoopback(host) && env.REMY_SERVE_ALLOW_REMOTE !== 'on')
    throw new Error(
      `remy serve listens on this machine only, so ${host} is refused. To reach it from elsewhere, use a private network such as Tailscale. To bind another address anyway, set REMY_SERVE_ALLOW_REMOTE=on; there is no TLS.`,
    );
  return { host, port };
}
