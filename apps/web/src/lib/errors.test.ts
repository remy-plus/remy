import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/http.ts';
import { describeError, GENERIC, OFFLINE, statusMessage } from './errors.ts';

describe('describeError', () => {
  it('names the status when the server sent no words of its own', () => {
    expect(describeError(new ApiError(402, GENERIC), 'fallback')).toMatch(/spending limit/);
    expect(describeError(new ApiError(401, GENERIC), 'fallback')).toMatch(/sign-in has expired/);
    expect(describeError(new ApiError(503, GENERIC), 'fallback')).toMatch(/hit a problem/);
  });

  it("keeps the server's own sentence, which knows more than a status does", () => {
    expect(describeError(new ApiError(400, 'That name is already taken.'), 'fallback')).toBe(
      'That name is already taken.',
    );
  });

  it('says the server is not answering when the network fails', () => {
    expect(describeError(new TypeError('Failed to fetch'), 'fallback')).toBe(OFFLINE);
  });

  it('falls back when there is nothing to say', () => {
    expect(describeError(null, 'fallback')).toBe('fallback');
    expect(describeError(new Error('   '), 'fallback')).toBe('fallback');
    expect(describeError('a string', 'fallback')).toBe('fallback');
  });

  it('has words for every status a person can hit', () => {
    for (const s of [400, 401, 402, 403, 404, 409, 413, 429, 500, 502, 503])
      expect(statusMessage(s)).toBeTruthy();
    expect(statusMessage(418)).toBeNull();
  });

  it('never says "something went wrong"', () => {
    for (const s of [400, 401, 402, 403, 404, 409, 413, 429, 500, 503]) {
      const said = statusMessage(s) ?? '';
      expect(said).not.toMatch(/something went wrong|an error occurred/i);
      expect(said.length).toBeGreaterThan(20);
    }
  });
});
