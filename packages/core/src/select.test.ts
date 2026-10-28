import { describe, expect, it } from 'vitest';
import { argsHash } from './hash.ts';
import { ToolRegistry } from './registry.ts';
import { builtins, fake, sixtyTools, stateFor } from './select.fixtures.ts';
import {
  bm25,
  createFindTools,
  needsSelection,
  rank,
  SELECT_THRESHOLD,
  SELECT_TOP,
  selectToolNames,
  tokenize,
} from './select.ts';
import type { TaskState } from './state.ts';
import type { Event, ToolContext } from './types.ts';

const offered = (reg: ToolRegistry, s: TaskState) =>
  selectToolNames(
    reg,
    s,
    reg.list().map((t) => t.name),
  );

const findToolsRun = (query: string, names: string[]): Event[] => [
  {
    type: 'model.responded',
    step: 1,
    calls: [{ callId: 'f', tool: 'find_tools', args: { query }, argsHash: argsHash({ query }) }],
    usage: { inTokens: 1, outTokens: 1 },
    costUsd: 0,
    latencyMs: 1,
  },
  { type: 'policy.decided', callId: 'f', decision: { kind: 'allow' } },
  { type: 'tool.started', callId: 'f', idempotencyKey: 'k', attempt: 1 },
  {
    type: 'tool.completed',
    callId: 'f',
    result: { ok: true, content: '', trust: 'trusted', data: { names } },
    latencyMs: 1,
  },
];

describe('tokenize', () => {
  it('splits snake_case, camelCase, server prefixes and plurals', () => {
    expect(tokenize('github__create_issue')).toEqual(['github', 'create', 'issue']);
    expect(tokenize('listCalendarEvents')).toEqual(['list', 'calendar', 'event']);
    expect(tokenize('Send a message to the channels')).toEqual(['send', 'message', 'channel']);
  });
});

describe('bm25 / rank', () => {
  const docs = [
    { name: 'a__post_message', text: 'Send a message to a channel' },
    { name: 'b__create_event', text: 'Create a calendar event' },
    { name: 'c__list_events', text: 'List events' },
  ];
  it('puts the best match first and drops non-matches', () => {
    expect(rank(docs, 'send a slack message', 5)).toEqual(['a__post_message']);
    expect(rank(docs, 'list calendar events', 5)).toEqual(['c__list_events', 'b__create_event']);
    expect(rank(docs, 'zzz', 5)).toEqual([]);
    expect(bm25(docs, '').size).toBe(0);
  });
  it('breaks ties by name, whatever the input order', () => {
    const tied = [
      { name: 'z__item', text: 'thing' },
      { name: 'a__item', text: 'thing' },
    ];
    expect(rank(tied, 'thing', 5)).toEqual(['a__item', 'z__item']);
    expect(rank([...tied].reverse(), 'thing', 5)).toEqual(['a__item', 'z__item']);
  });
});

describe('selectToolNames', () => {
  const reg = new ToolRegistry([...builtins(), ...sixtyTools()]);

  it('offers everything under the threshold', () => {
    const small = new ToolRegistry([...builtins(), ...sixtyTools().slice(0, SELECT_THRESHOLD)]);
    expect(needsSelection(small)).toBe(false);
    expect(offered(small, stateFor('anything'))).toHaveLength(3 + SELECT_THRESHOLD);
  });

  it('offers only built-ins when nothing is selectable', () => {
    const plain = new ToolRegistry(builtins());
    expect(offered(plain, stateFor('hi'))).toEqual(['read_file', 'finish', 'ask_user']);
  });

  it.each([
    ['create a github issue for the login bug', 'github__create_issue'],
    ['send a slack message to the team', 'slack__post_message'],
    ['list calendar events for next week', 'calendar__list_events'],
  ])('offers the right tools for "%s"', (prompt, want) => {
    const names = offered(reg, stateFor(prompt));
    expect(names).toContain(want);
    expect(names).toEqual(expect.arrayContaining(['read_file', 'finish', 'ask_user']));
    expect(names.length).toBeLessThanOrEqual(3 + SELECT_TOP);
  });

  it('is deterministic and independent of registry order', () => {
    const rev = new ToolRegistry([...builtins(), ...sixtyTools().reverse()]);
    const s = stateFor('create a github issue');
    expect([...offered(rev, s)].sort()).toEqual([...offered(reg, s)].sort());
    expect(offered(reg, s)).toEqual(offered(reg, s));
  });

  it('follows the latest plan', () => {
    const plan = { steps: [{ text: 'post a message in slack', status: 'doing' }] };
    const s = stateFor('help me with the launch', {
      type: 'model.responded',
      step: 1,
      text: 'I will start now',
      calls: [{ callId: 'p', tool: 'update_plan', args: plan, argsHash: argsHash(plan) }],
      usage: { inTokens: 1, outTokens: 1 },
      costUsd: 0,
      latencyMs: 1,
    });
    expect(offered(reg, s)).toContain('slack__post_message');
  });

  it('keeps tools that find_tools returned', () => {
    const s = stateFor('create a github issue', ...findToolsRun('x', ['drive__share_file']));
    expect(s.discovered).toEqual(['drive__share_file']);
    expect(offered(reg, s)).toContain('drive__share_file');
    expect(offered(reg, stateFor('create a github issue'))).not.toContain('drive__share_file');
  });
});

describe('find_tools', () => {
  const reg = new ToolRegistry([...builtins(), ...sixtyTools()]);
  const find = createFindTools(reg);
  const run = (query: string) => find.execute({ query }, {} as ToolContext);

  it('is a trusted read tool with no effect', () => {
    expect([find.risk, find.effect, find.outputTrust]).toEqual(['read', 'none', 'trusted']);
  });

  it('lists names with one-line descriptions, only for selectable tools', async () => {
    const r = await run('share a file with someone');
    if (!r.ok) throw new Error('failed');
    expect(r.content).toContain('drive__share_file: Share a file (via drive)');
    const names = (r.data as { names: string[] }).names;
    expect(names).not.toContain('read_file');
    expect(names.length).toBeLessThanOrEqual(8);
  });

  it('says so when nothing matches', async () => {
    expect(await run('zzzz')).toMatchObject({ ok: true, data: { names: [] } });
  });

  it('ignores a registry with only built-ins', async () => {
    const none = createFindTools(new ToolRegistry([fake('read_file', 'Read', false)]));
    expect(await none.execute({ query: 'read' }, {} as ToolContext)).toMatchObject({
      data: { names: [] },
    });
  });
});
