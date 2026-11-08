// Where the listener may bind. Loopback only, unless REMY_WEBHOOK_ALLOW_REMOTE=on is also set.
// There is no TLS here: for another machine, use a private network such as Tailscale.
import { isIP } from 'node:net';

export const DEFAULT_PORT = 7788;
export const LOOPBACK = '127.0.0.1';

export function isLoopback(address: string): boolean {
  if (address === 'localhost') return true;
  if (isIP(address) === 4) return address.startsWith('127.');
  return address === '::1';
}

export interface Bind {
  host: string;
  port: number;
}

/** Works out host and port, or throws a plain error when the address is not allowed. */
export function resolveBind(
  opts: { bind?: string; port?: string },
  env: Record<string, string | undefined>,
): Bind {
  const host = opts.bind ?? LOOPBACK;
  const raw = opts.port ?? env.REMY_WEBHOOK_PORT;
  const port = raw === undefined ? DEFAULT_PORT : Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error('The webhook port must be a number from 0 to 65535.');
  if (!isLoopback(host) && env.REMY_WEBHOOK_ALLOW_REMOTE !== 'on')
    throw new Error(
      `Webhooks listen on this machine only, so ${host} is refused. To reach them from elsewhere, use a private network such as Tailscale. To bind another address anyway, set REMY_WEBHOOK_ALLOW_REMOTE=on; there is no TLS.`,
    );
  return { host, port };
}
