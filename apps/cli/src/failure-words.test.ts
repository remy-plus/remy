// What a person reads when the model fails: one plain sentence that says what happened and what to do.
import { describe, expect, it } from 'vitest';
import { explainModelError, type Surface } from './provider-error.ts';

const JARGON = /ECONN|ENOTFOUND|fetch failed|HTTP \d|schema|JSON|[{}]|undefined|stack/i;

const cases: [string, string, RegExp][] = [
  [
    'a wrong key',
    'The model failed: HTTP 401: {"error":{"message":"Incorrect API key provided: sk-abc","code":"invalid_api_key"}}',
    /key was rejected/,
  ],
  [
    'an out-of-credit key',
    'The model failed: this key is out of credit or over its spend limit. Add credit or use another key. Insufficient credits',
    /out of credit/,
  ],
  [
    'a model that does not exist',
    'The model failed: HTTP 404: {"error":{"message":"The model `nope-1` does not exist or you do not have access to it.","code":"model_not_found"}}',
    /cannot use that model/,
  ],
  ['no network', 'The model failed: network error: fetch failed', /Could not reach the model/],
  ['a timeout', 'The model failed: timed out after 120000ms', /took too long/],
  [
    'a provider outage',
    'The model failed: HTTP 500: {"error":{"message":"Internal server error"}}',
    /problem on its side/,
  ],
  ['an empty reply', 'The model failed: the model returned an empty reply', /empty reply/],
  ['an unreadable reply', 'The model failed: invalid JSON in response body', /could not read/],
  [
    'a cut-off reply',
    'The model failed: the reply was cut off before it finished',
    /could not read|cut off/,
  ],
  [
    'a made-up tool',
    'The model failed: tool call still invalid after 2 retries: Unknown tool "does_not_exist". Available tools: read_file, write_file',
    /kept asking for something Remy cannot do/,
  ],
  [
    'broken tool arguments',
    'The model failed: tool call still invalid after 2 retries: Arguments for tool "write_file" are not a valid JSON object: {"path": "a.txt',
    /kept asking for something Remy cannot do/,
  ],
];

describe.each<Surface>(['chat', 'run', 'web'])('failure words on %s', (surface) => {
  it.each(cases)('%s', (_name, raw, expected) => {
    const said = explainModelError(raw, surface);
    expect(said).toMatch(expected);
    expect(said).not.toMatch(JARGON);
    expect(said).not.toContain('!');
    expect(said?.length).toBeLessThan(220);
  });
});

describe('the next step names a command that exists on that surface', () => {
  const key = 'The model failed: HTTP 401: nope';
  it('chat uses slash commands', () => {
    expect(explainModelError(key, 'chat')).toContain('/login');
  });
  it('run and web use the terminal command', () => {
    expect(explainModelError(key, 'run')).toContain('remy login');
    expect(explainModelError(key, 'web')).toContain('remy login');
    expect(explainModelError(key, 'run')).not.toContain('/login');
  });
});
