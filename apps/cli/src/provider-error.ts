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

/** Where the words are read: the chat, `remy run` and friends, or the web app. Each has its own commands. */
export type Surface = 'chat' | 'run' | 'web';

const WORDS: Record<Surface, { login: string; switchCmd: string; again: string }> = {
  chat: { login: '/login', switchCmd: '/model', again: 'send your message again' },
  run: { login: 'remy login', switchCmd: 'remy login', again: 'run it again' },
  web: {
    login: 'remy login in a terminal',
    switchCmd: 'remy login in a terminal',
    again: 'start the task again',
  },
};

const num = (n: number) => n.toLocaleString('en-US');

/**
 * A request refused for carrying more images than the model takes (Mistral answers code 3051 with
 * "Total number of images exceeds the maximum allowed of 20"). Shortening the text does not help,
 * so this is answered before the size checks below.
 */
const IMAGE_LIMIT = /total number of images exceeds the maximum allowed of (\d+)/i;

/** A request the provider refused for its size (HTTP 413, a token cap below the request, a context limit). */
export function explainTooLarge(raw: string, surface: Surface = 'chat'): string | undefined {
  const { switchCmd } = WORDS[surface];
  const m = bodyMessage(raw);
  const images = IMAGE_LIMIT.exec(m)?.[1];
  if (images) {
    const who = providerName(raw);
    const owner = who === 'The provider' ? 'this model' : who;
    return `This request carries more images than ${owner} accepts (${images} at most). Send fewer images, or switch models with ${switchCmd}.`;
  }
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
  const next = `Try a shorter request, or switch models with ${switchCmd}.`;
  if (limit !== undefined && asked !== undefined && /per minute|tpm/i.test(m))
    return `${owner} allows ${num(Number(limit.replace(/,/g, '')))} tokens a minute on this key; this request needed ${num(Number(asked.replace(/,/g, '')))}. ${next}`;
  return `This request is larger than ${who === 'The provider' ? 'the model accepts' : `${who} accepts`}. ${next}`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A model failure in plain words, ending with the one thing to do. Undefined when unknown. */
export function explainModelError(msg: string, surface: Surface = 'chat'): string | undefined {
  const { login, switchCmd, again } = WORDS[surface];
  if (/daily limit is used up|tokens per day|requests per day/i.test(msg)) {
    const wait = /try again in ([\dhm.]+s?)/i.exec(msg)?.[1]?.replace(/\.\d+s$/, 's');
    return `${providerName(msg)}'s daily limit for this model is used up. ${wait ? `Try again in ${wait}, or switch` : 'Switch'} with ${switchCmd}.`;
  }
  const large = explainTooLarge(msg, surface);
  if (large) return large;
  const m = msg.toLowerCase();
  if (/http (401|403)\b|invalid api key|incorrect api key|unauthorized|api_key_invalid/.test(m))
    return `The key was rejected. Run ${login} to replace it.`;
  if (/http 429|rate limit|too many requests/.test(m))
    return `${providerName(msg)} is rate-limiting this key. Wait a minute and ${again}, or switch with ${switchCmd}.`;
  if (/insufficient_quota|exceeded your current quota|http 402|out of credit/.test(m))
    return `The account is out of credit. Add credit with the provider, or switch with ${switchCmd}.`;
  if (/http 404|model_not_found|does not exist|not found/.test(m) && /model/.test(m))
    return `This key cannot use that model. Pick another with ${switchCmd}.`;
  if (/http 404/.test(m))
    return `The provider has nothing at that address. Check it with ${login}.`;
  if (/timed out|etimedout/.test(m))
    return `The model took too long to answer. Check your connection, then ${again}.`;
  if (/network error|fetch failed|enotfound|econnrefused|econnreset/.test(m))
    return `Could not reach the model. Check your connection, then ${again}.`;
  if (/http 5\d\d\b/.test(m)) {
    const who = providerName(msg) === 'The provider' ? "The model's provider" : providerName(msg);
    return `${who} had a problem on its side. Wait a moment, then ${again}, or switch with ${switchCmd}.`;
  }
  if (/empty reply/.test(m))
    return `The model sent back an empty reply each time. ${capital(again)}, or switch with ${switchCmd}.`;
  if (
    /invalid json in response|reply was cut off|response has no choices|response has no body/.test(
      m,
    )
  )
    return `The model's server sent a reply Remy could not read. ${capital(again)}, or switch with ${switchCmd}.`;
  if (/tool call still invalid|no valid tool call/.test(m))
    return `The model kept asking for something Remy cannot do, so Remy stopped it. ${capital(again)}, or switch with ${switchCmd}.`;
  return undefined;
}
