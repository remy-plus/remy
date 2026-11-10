// How the app says "when": plain relative words, and a 12-hour clock only when a clock is unavoidable.
// Never military time. `now` is injectable so tests are exact.
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "just now", "5 min ago", "2 hours ago", "yesterday", "Tuesday", "12 Oct". */
export function ago(iso: string | number | Date, now: Date = new Date()): string {
  const t = new Date(iso);
  const diff = now.getTime() - t.getTime();
  if (Number.isNaN(diff)) return '';
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) {
    const m = Math.max(1, Math.round(diff / MIN));
    return `${m} min ago`;
  }
  const days = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  if (days === 0) {
    const h = Math.round(diff / HOUR);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(t);
  return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(t);
}

/** "6:41 PM": a clock for the rare place that needs one. */
export function clock(iso: string | number | Date): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso));
}

/** "Good morning", "Good afternoon" or "Good evening". */
export function greeting(now: Date = new Date()): string {
  const h = now.getHours();
  if (h < 5) return 'Still up';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The chat history groups: "Today", "Yesterday", "This week", "Earlier". */
export function group(iso: string | number | Date, now: Date = new Date()): string {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso))) / DAY);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return 'This week';
  return 'Earlier';
}
