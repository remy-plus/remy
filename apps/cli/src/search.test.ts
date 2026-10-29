import { describe, expect, it } from 'vitest';
import { pickSearch } from './search.ts';

describe('pickSearch', () => {
  it('uses the browser when nothing is picked and no key is set', () => {
    expect(pickSearch({}, undefined)).toEqual({ choice: 'browser' });
  });

  it('uses a service whose key is set, Context.dev first', () => {
    const env = { BRAVE_API_KEY: 'b', CONTEXT_DEV_API_KEY: 'c' };
    expect(pickSearch(env, undefined).choice).toBe('context');
    expect(pickSearch({ TAVILY_API_KEY: 't' }, undefined).choice).toBe('tavily');
  });

  it('follows the pick over the keys', () => {
    const env = { CONTEXT_DEV_API_KEY: 'c', BRAVE_API_KEY: 'b' };
    expect(pickSearch(env, 'brave').choice).toBe('brave');
    expect(pickSearch(env, 'Browser')).toEqual({ choice: 'browser' });
    expect(pickSearch(env, 'off')).toEqual({ choice: 'off' });
    expect(pickSearch(env, 'context').provider).toBeDefined();
  });

  it('says which key a picked service needs, and rejects unknown picks', () => {
    expect(() => pickSearch({}, 'context')).toThrow('needs CONTEXT_DEV_API_KEY');
    expect(() => pickSearch({}, 'google')).toThrow('REMY_SEARCH must be one of');
  });
});
