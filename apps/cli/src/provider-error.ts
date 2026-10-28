// Turns provider error bodies (OpenAI-compatible, Anthropic, Gemini) into short sentences.
// Raw bodies stay in the event log: `remy show <task>` and --debug print them in full.

/** The human-readable message inside a provider error body, or the text itself when there is no JSON. */
export function bodyMessage(raw: string): string {
  const start = raw.search(/[{[]/);
  if (start < 0) return raw;
  const prefix = raw.slice(0, start).trim();
  const body = raw.slice(start);
  let message: string | undefined;
  try {
    const parsed: unknown = JSON.parse(body);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    const err = (first as { error?: unknown } | undefined)?.error ?? first;
    const m = (err as { message?: unknown } | undefined)?.message;
    if (typeof m === 'string') message = m;
  } catch {
    // Bodies are cut at 500 characters, so they often do not parse: take the message by pattern.
    const m = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(body);
    if (m?.[1]) message = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"');
  }
  return message ? `${prefix} ${message}`.trim() : raw;
}

export function providerName(raw: string): string {
  if (/groq|service tier|on_demand/i.test(raw)) return 'Groq';
  if (/anthropic|"type"\s*:\s*"error"|rate_limit_error|overloaded_error/i.test(raw))
    return 'Anthropic';
  if (/gemini|generativelanguage|resource_exhausted/i.test(raw)) return 'Gemini';
  if (/openrouter/i.test(raw)) return 'OpenRouter';
  return 'The provider';
}

const num = (n: number) => n.toLocaleString('en-US');

/** A request the provider refused for its size (HTTP 413, a token cap below the request, a context limit). */
export function explainTooLarge(raw: string): string | undefined {
  const m = bodyMessage(raw);
  const limit = /\blimit\s+(\d[\d,]*)/i.exec(m)?.[1];
  const asked = /\brequested\s+(\d[\d,]*)/i.exec(m)?.[1];
  const over =
    limit !== undefined &&
    asked !== undefined &&
    Number(asked.replace(/,/g, '')) > Number(limit.replace(/,/g, ''));
  const size =
    /http 413|request too large|reduce your message size|request_too_large|still too large|prompt is too long|context[_ ]length|maximum context|exceeds the maximum|maximum number of tokens|input token count/i.test(
      `${raw} ${m}`,
    );
  if (!size && !over) return undefined;
  const who = providerName(raw);
  const owner = who === 'The provider' ? 'This provider' : who;
  const next = 'Try a shorter request, or switch models with /model.';
  if (limit !== undefined && asked !== undefined && /per minute|tpm/i.test(m))
    return `${owner} allows ${num(Number(limit.replace(/,/g, '')))} tokens a minute on this key; this request needed ${num(Number(asked.replace(/,/g, '')))}. ${next}`;
  return `This request is larger than ${who === 'The provider' ? 'the model accepts' : `${who} accepts`}. ${next}`;
}
