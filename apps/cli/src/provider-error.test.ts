import { describe, expect, it } from 'vitest';
import { explainModelError, friendlyError } from './chat.ts';
import { bodyMessage } from './provider-error.ts';

const groq413 =
  'HTTP 413: {"error":{"message":"Request too large for model `openai/gpt-oss-120b` in organization `org_01` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Requested 17786, please reduce your message size and try again.","type":"tokens","code":"rate_limit_exceeded"}}';
const groq429 =
  'HTTP 429: {"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` service tier `on_demand` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 500. Please try again in 3s.","type":"tokens","code":"rate_limit_exceeded"}}';

describe('provider errors in plain words', () => {
  it('explains a request over the tokens-per-minute cap with the numbers', () => {
    expect(explainModelError(groq413)).toBe(
      'Groq allows 8,000 tokens a minute on this key; this request needed 17,786. Try a shorter request, or switch models with /model.',
    );
    const after = `The model failed: the request is still too large after shortening tool results (${groq413})`;
    expect(explainModelError(after)).toContain('17,786');
  });

  it('names the provider when it is rate limiting and ends with the next step', () => {
    expect(explainModelError(groq429)).toBe(
      'Groq is rate-limiting this key. Wait a minute and send your message again, or switch with /model.',
    );
  });

  it('handles Anthropic and Gemini bodies', () => {
    const anthropic =
      'HTTP 400: {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 250000 tokens > 200000 maximum"}}';
    expect(explainModelError(anthropic)).toContain('shorter request');
    expect(explainModelError(anthropic)).toContain('Anthropic');
    const gemini =
      'HTTP 429: [{"error":{"code":429,"message":"Resource has been exhausted (e.g. check quota).","status":"RESOURCE_EXHAUSTED"}}]';
    expect(explainModelError(gemini)).toMatch(/^Gemini is rate-limiting/);
  });

  it('never shows raw JSON, even for errors it does not know, and survives cut-off bodies', () => {
    const odd = 'HTTP 400: {"error":{"message":"The widget is sideways","type":"weird"}}';
    expect(friendlyError(new Error(odd))).not.toMatch(/[{}"]/);
    expect(bodyMessage('HTTP 400: {"error":{"message":"cut off here and the rest is miss')).toBe(
      'HTTP 400: cut off here and the rest is miss',
    );
    expect(bodyMessage('plain text')).toBe('plain text');
  });
});
