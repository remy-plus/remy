import { createHash } from 'node:crypto';

/** JSON with object keys sorted at every level, so equal values serialize identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? 'null';
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

export function argsHash(args: unknown): string {
  return createHash('sha256').update(canonicalJson(args)).digest('hex').slice(0, 32);
}

export const idempotencyKey = (taskId: string, callId: string) => `${taskId}:${callId}`;
