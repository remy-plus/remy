import { describe, expect, it } from 'vitest';
import type { CallView } from '../api/types.ts';
import { approvalSentence, feedLines, plainStep } from './feed.ts';

describe('plainStep', () => {
  it.each([
    ['read_file', { path: 'quotes/acme.md' }, 'Reading quotes/acme.md', 'Read quotes/acme.md'],
    ['write_file', { path: 'reply.md' }, 'Writing reply.md', 'Wrote reply.md'],
    ['edit_file', { path: 'a.ts' }, 'Editing a.ts', 'Edited a.ts'],
    ['delete_file', { path: 'old.txt' }, 'Deleting old.txt', 'Deleted old.txt'],
    ['move_file', { from: 'a.txt', to: 'b.txt' }, 'Moving a.txt', 'Moved a.txt'],
    ['make_dir', { path: 'reports' }, 'Creating folder reports', 'Created folder reports'],
    ['list_files', { path: '.' }, 'Looking through your files', 'Looked through your files'],
    [
      'web_search',
      { query: 'flights to Lisbon' },
      'Searching the web for flights to Lisbon',
      'Searched the web for flights to Lisbon',
    ],
    [
      'fetch_url',
      { url: 'https://www.northwind.com/about' },
      'Opening northwind.com',
      'Opened northwind.com',
    ],
    ['run_command', { program: 'git' }, 'Running a command', 'Ran a command'],
    ['computer_run', { command: 'ls' }, 'Running a command', 'Ran a command'],
    ['calculate', { expression: '2+2' }, 'Calculating', 'Calculated'],
    ['ask_user', { question: 'Which one?' }, 'Asking you something', 'Asked you something'],
    ['remember', {}, 'Making a note', 'Made a note'],
    ['recall', {}, 'Checking what it knows', 'Checked what it knows'],
    ['update_plan', {}, 'Planning the next steps', 'Planned the next steps'],
  ])('%s', (tool, args, now, past) => {
    expect(plainStep(tool, args)).toEqual({ now, past });
  });

  it('falls back without naming the tool', () => {
    expect(plainStep('create_issue').now).toBe('Working on it');
    expect(plainStep('read_file').now).toBe('Reading a file');
  });
});

const call = (over: Partial<CallView> & { args?: unknown }): CallView => ({
  callId: 'c1',
  tool: 'read_file',
  step: 1,
  argsHash: 'abc123',
  attempts: 1,
  inFlight: false,
  ...over,
});

describe('feedLines', () => {
  it('makes one plain line per call and skips finish', () => {
    const lines = feedLines([
      call({
        callId: 'b',
        step: 2,
        tool: 'write_file',
        args: { path: 'reply.md' },
        inFlight: true,
      }),
      call({
        callId: 'a',
        step: 1,
        args: { path: 'q.md' },
        result: { ok: true, content: 'hello', truncated: false },
      }),
      call({ callId: 'z', step: 3, tool: 'finish' }),
    ]);
    expect(lines.map((l) => l.text)).toEqual(['Read q.md', 'Writing reply.md']);
    expect(lines[0]?.snippet).toBe('hello');
    expect(JSON.stringify(lines)).not.toMatch(/abc123|read_file/);
  });

  it('marks waiting and failed', () => {
    const lines = feedLines(
      [
        call({ callId: 'w', tool: 'run_command' }),
        call({ callId: 'f', step: 2, tool: 'calculate', result: { ok: false, error: 'x' } }),
      ],
      'w',
    );
    expect(lines.map((l) => l.state)).toEqual(['waiting', 'failed']);
  });
});

describe('approvalSentence', () => {
  it('uses the preview, else a sentence from the risk', () => {
    expect(approvalSentence('Send the reply to Dana', 'send_as_user')).toBe(
      'Send the reply to Dana',
    );
    expect(approvalSentence('', 'spend_money')).toBe('Remy wants to spend money.');
  });
});
