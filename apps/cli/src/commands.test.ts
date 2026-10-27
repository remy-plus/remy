import { describe, expect, it } from 'vitest';
import { COMMANDS, findCommand, fuzzyScore, matchCommands } from './commands.ts';

describe('commands', () => {
  it('lists every command when nothing is typed', () => {
    expect(matchCommands('')).toEqual(COMMANDS);
  });

  it('puts prefix matches first', () => {
    expect(matchCommands('mo')[0]?.name).toBe('model');
    expect(matchCommands('se')[0]?.name).toBe('sessions');
  });

  it('matches aliases and summaries', () => {
    expect(matchCommands('resume')[0]?.name).toBe('sessions');
    expect(matchCommands('connect')[0]?.name).toBe('login');
    expect(matchCommands('reasoning').map((c) => c.name)).toContain('thinking');
  });

  it('finds nothing for nonsense', () => {
    expect(matchCommands('zzq')).toEqual([]);
  });

  it('resolves aliases', () => {
    expect(findCommand('resume')?.name).toBe('sessions');
    expect(findCommand('quit')?.name).toBe('exit');
    expect(findCommand('nope')).toBeUndefined();
  });

  it('scores letters in order and ignores case', () => {
    expect(fuzzyScore('GPT', 'gpt-5-nano')).toBeGreaterThan(0);
    expect(fuzzyScore('g5n', 'gpt-5-nano')).toBeDefined();
    expect(fuzzyScore('xyz', 'gpt-5-nano')).toBeUndefined();
    expect(fuzzyScore('gpt', 'gpt-5-nano') as number).toBeGreaterThan(
      fuzzyScore('gpt', 'my-gpt') as number,
    );
  });
});
