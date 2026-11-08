// Blocks an address after repeated wrong tokens: 5 failures within a minute block it for 5 minutes.
// A blocked address is refused even with the right token. The table is bounded.
export const MAX_FAILURES = 5;
export const FAILURE_WINDOW_MS = 60_000;
export const BLOCK_MS = 5 * 60_000;
const MAX_TRACKED = 1000;

export interface Lockout {
  blocked(address: string): boolean;
  fail(address: string): void;
}

export function createLockout(
  now: () => number = Date.now,
  /** How long a blocked address stays blocked. Webhooks use 5 minutes, `remy serve` 1 minute. */
  blockMs: number = BLOCK_MS,
): Lockout {
  const failures = new Map<string, number[]>();
  const until = new Map<string, number>();
  const prune = () => {
    const t = now();
    for (const [a, u] of until) if (u <= t) until.delete(a);
    for (const [a, list] of failures) {
      const live = list.filter((f) => t - f < FAILURE_WINDOW_MS);
      if (live.length) failures.set(a, live);
      else failures.delete(a);
    }
  };
  return {
    blocked(address) {
      const u = until.get(address);
      if (u === undefined) return false;
      if (u > now()) return true;
      until.delete(address);
      return false;
    },
    fail(address) {
      const t = now();
      if (failures.size + until.size > MAX_TRACKED) prune();
      const live = (failures.get(address) ?? []).filter((f) => t - f < FAILURE_WINDOW_MS);
      live.push(t);
      if (live.length >= MAX_FAILURES) {
        until.set(address, t + blockMs);
        failures.delete(address);
      } else failures.set(address, live);
    },
  };
}
