// What `remy serve` prints so a phone on the same network can sign in by scanning: for each address
// the phone can reach, a one-time link and the same link as a QR code. The code is made here and
// shown on the terminal only; it is never logged or saved (see serve-signin.ts).
import { encodeQr, renderQr } from './qr.ts';
import { type SignInCodes, signInLinkAt } from './serve-signin.ts';

export const NETWORK_WARNING =
  'There is no encryption on this network. Use it only on a home network you trust; for anything else, use Tailscale.';

/** A code's QR block and link as lines of text. A link too long for a QR code is shown as text only. */
export function qrLines(link: string, color: boolean): string[] {
  try {
    return renderQr(encodeQr(link), { color });
  } catch {
    return [];
  }
}

/**
 * The lines to print for the given addresses (`http://host:port`), each with its own code. Another
 * code is kept valid alongside, so scanning one does not spoil the rest. Empty with no address.
 */
export function phoneSignInLines(
  origins: readonly string[],
  codes: SignInCodes,
  opts: { color: boolean },
): string[] {
  const lines: string[] = [];
  for (const origin of origins) {
    const link = signInLinkAt(origin, codes.mint({ keep: true }));
    lines.push(
      '',
      `To sign in on your phone, scan this with its camera (${origin}). It works once, for 10 minutes.`,
      ...qrLines(link, opts.color),
      `Or open: ${link}`,
    );
  }
  if (lines.length > 0) lines.push('', NETWORK_WARNING);
  return lines;
}
