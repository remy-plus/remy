export type KeyCheck = 'ok' | 'rejected' | 'unreachable';

export interface VerifyOptions {
  /** Wire format of the provider. Default `openai` (any OpenAI-compatible API). */
  kind?: 'openai' | 'anthropic' | 'google';
  baseUrl: string;
  key?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** One cheap request (list models) that tells a good key from a bad one. The key is never put in a URL. */
export async function verifyKey(o: VerifyOptions): Promise<KeyCheck> {
  const base = o.baseUrl.replace(/\/+$/, '');
  const kind = o.kind ?? 'openai';
  const headers: Record<string, string> = {};
  let url = `${base}/models`;
  if (kind === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (o.key) headers['x-api-key'] = o.key;
    url += '?limit=1';
  } else if (kind === 'google') {
    if (o.key) headers['x-goog-api-key'] = o.key;
    url += '?pageSize=1';
  } else if (o.key) headers.authorization = `Bearer ${o.key}`;
  try {
    const res = await (o.fetchImpl ?? fetch)(url, {
      headers,
      signal: AbortSignal.timeout(o.timeoutMs ?? 10_000),
    });
    if (res.ok) return 'ok';
    // Google answers a bad key with 400 (API_KEY_INVALID); the others use 401 or 403.
    if (res.status === 401 || res.status === 403) return 'rejected';
    if (kind === 'google' && res.status === 400) return 'rejected';
    return 'unreachable';
  } catch {
    return 'unreachable';
  }
}
