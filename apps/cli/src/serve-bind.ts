// Where `remy serve` may listen. Loopback only, unless REMY_SERVE_ALLOW_REMOTE=on is also set.
// There is no TLS here: for another machine, use a private network such as Tailscale.
import { isLoopback, LOOPBACK } from './webhook-bind.ts';

/** Not the webhook port (7788), so both can run at once. */
export const SERVE_DEFAULT_PORT = 7790;

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
  const port = opts.port === undefined ? SERVE_DEFAULT_PORT : Number(opts.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('The port must be a number from 0 to 65535.');
  if (!isLoopback(host) && env.REMY_SERVE_ALLOW_REMOTE !== 'on')
    throw new Error(
      `remy serve listens on this machine only, so ${host} is refused. To reach it from elsewhere, use a private network such as Tailscale. To bind another address anyway, set REMY_SERVE_ALLOW_REMOTE=on; there is no TLS.`,
    );
  return { host, port };
}

type Interfaces = Record<
  string,
  { address: string; family: string | number; internal: boolean }[] | undefined
>;

/**
 * The addresses a phone on the same network can type, when the server listens on every interface
 * (0.0.0.0 or ::). "http://0.0.0.0:7790" is not one a person can use. Empty for a single address.
 */
export function reachableUrls(host: string, port: number, interfaces: Interfaces): string[] {
  if (host !== '0.0.0.0' && host !== '::') return [];
  const out: string[] = [];
  for (const list of Object.values(interfaces))
    for (const a of list ?? [])
      if (
        !a.internal &&
        (a.family === 'IPv4' || a.family === 4) &&
        !a.address.startsWith('169.254.')
      )
        out.push(`http://${a.address}:${port}`);
  return [...new Set(out)];
}

/**
 * The addresses a phone can open and sign in on: every reachable address when the server listens
 * on every interface, the one address when it listens on a single non-loopback address (a home
 * network or a Tailscale address), and none on loopback, where a phone cannot reach it.
 */
export function phoneUrls(host: string, port: number, interfaces: Interfaces): string[] {
  if (host === '0.0.0.0' || host === '::') return reachableUrls(host, port, interfaces);
  if (isLoopback(host)) return [];
  const name = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  return [`http://${name}:${port}`];
}
