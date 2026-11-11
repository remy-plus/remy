import { describe, expect, it } from 'vitest';
import { humanTool, plainTime, RISK, stateWord, trustWords } from './format.ts';

describe('task words', () => {
  it('says a time in 12-hour words, whatever the server sent', () => {
    expect(plainTime('18:40')).toMatch(/6:40\s?PM/i);
    expect(plainTime('07:05:30')).toMatch(/7:05\s?AM/i);
    expect(plainTime('2026-11-08T18:40:00.000Z')).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    // Anything that is not a time is left exactly as it came.
    expect(plainTime('yesterday')).toBe('yesterday');
    expect(plainTime('')).toBe('');
  });

  it('never puts a tool name on the screen', () => {
    expect(humanTool('read_file')).toBe('Read a file');
    expect(humanTool('create_issue')).toBe('Worked on it');
    expect(humanTool('create_issue')).not.toMatch(/_/);
  });

  it('says a job that stopped did not finish', () => {
    expect(stateWord('failed')).toBe("didn't finish");
    expect(stateWord('cancelled')).toBe("didn't finish");
    expect(stateWord('running')).toBe('working');
    expect(stateWord('waiting_approval')).toBe('waiting for your OK');
  });

  it('says what each answer does, for every kind of action', () => {
    for (const risk of Object.values(RISK)) {
      expect(risk.after).toMatch(/\.$/);
      expect(risk.stopped).toMatch(/^Nothing/);
      expect(risk.decline).toBe('Not now');
    }
    expect(RISK.send_as_user.stopped).toBe('Nothing was sent.');
    expect(RISK.spend_money.stopped).toBe('Nothing was paid.');
  });

  it('says how much Remy does on its own in plain words', () => {
    expect(trustWords.ask).toBe('Check with me first');
    expect(trustWords.away).toBe("Work on its own while I'm away");
  });
});
