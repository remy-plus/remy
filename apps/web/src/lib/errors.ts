// One place that turns a failure into a plain sentence: what happened, and what to do next.
// "Something went wrong" is the fastest way to make an app feel cheap, so every status the server
// can send has its own words, and a server that cannot be reached says so instead of "Failed to fetch".

/** The sentence for a status the server sent, or null when the status alone says nothing useful. */
export function statusMessage(status: number): string | null {
  switch (status) {
    case 400:
      return 'Remy could not read that request. Check what you typed, then try again.';
    case 401:
      return 'Your sign-in has expired. Sign in again to carry on.';
    case 402:
      return "This month's spending limit is reached. Raise it in Settings, under Spending, or wait until next month.";
    case 403:
      return "Remy is not allowed to do that. Check the app's permissions in Connections.";
    case 404:
      return 'That is gone now. It may have been deleted or moved.';
    case 409:
      return 'Something changed while you were looking. Reload to see the latest.';
    case 413:
      return 'That is too large to send. Try a smaller one.';
    case 429:
      return 'Too many requests just now. Wait a moment, then try again.';
    default:
      return status >= 500 ? "Remy's server hit a problem. Try again in a moment." : null;
  }
}

/** What the adapter says when the server sent no words of its own. Replaced by the status sentence. */
export const GENERIC = 'The request failed. Check that Remy is still running, then try again.';

/** A server that is not there at all: the browser's own words for this are "Failed to fetch". */
export const OFFLINE = "Remy's server is not answering. Check that it is running, then try again.";

/** The status an error carries, without importing the adapter's class (that would be a cycle). */
const statusOf = (e: unknown): number | null => {
  const s = (e as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
};

/**
 * The sentence to show for any failure. The server's own words win when it sent some, because they
 * know more than a status code does; otherwise the status, then the caller's fallback.
 */
export function describeError(e: unknown, fallback: string): string {
  const status = statusOf(e);
  if (status !== null) {
    const said = e instanceof Error ? e.message.trim() : '';
    if (said && said !== GENERIC) return said;
    return statusMessage(status) ?? fallback;
  }
  // fetch throws a TypeError when the server is unreachable or the network drops.
  if (e instanceof TypeError) return OFFLINE;
  if (e instanceof Error && e.message.trim()) return e.message;
  return fallback;
}
