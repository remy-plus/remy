// Tool selection through the real runtime: what each model request offers, find_tools, resume.
import {
  createRuntime,
  DEFAULT_BUDGET,
  defineTool,
  fold,
  type ModelRequest,
  type ModelResponse,
  type Runtime,
  type TaskConfig,
  type Tool,
  ToolRegistry,
} from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const tool = (name: string, description: string, selectable: boolean, onRun?: () => void): Tool =>
  defineTool({
    name,
    description,
    args: z.object({}).passthrough(),
    selectable,
    risk: 'read',
    effect: 'none',
    outputTrust: 'trusted',
    timeoutMs: 1000,
    maxOutputChars: 1000,
    preview: () => name,
    execute: async () => {
      onRun?.();
      return { ok: true, content: `ran ${name}`, trust: 'trusted' };
    },
  });

const SERVICES: Record<string, string[]> = {
  github: ['create_issue', 'list_issues', 'update_issue', 'create_pull_request', 'search_code'],
  slack: ['post_message', 'list_channels', 'reply_to_thread', 'add_reaction', 'search_messages'],
  calendar: ['list_events', 'create_event', 'update_event', 'delete_event', 'find_free_time'],
  notion: ['search_pages', 'create_page', 'update_page', 'query_database', 'get_page'],
  linear: ['create_ticket', 'list_tickets', 'update_ticket', 'list_projects', 'list_cycles'],
  drive: ['list_files', 'read_document', 'create_folder', 'share_file', 'delete_file'],
};

const mcpTools = (onRun?: (name: string) => void) =>
  Object.entries(SERVICES).flatMap(([server, names]) =>
    names.map((n) =>
      tool(`${server}__${n}`, `${n.replaceAll('_', ' ')} (via ${server})`, true, () =>
        onRun?.(`${server}__${n}`),
      ),
    ),
  );

const builtin = () => [
  tool('finish', 'Finish the task', false),
  tool('ask_user', 'Ask the user a question', false),
  tool('read_file', 'Read a file', false),
];

const config: TaskConfig = {
  model: 'scripted',
  permissions: { autoApprove: ['read'] },
  budget: DEFAULT_BUDGET,
  workspaceDir: '/w',
};

const names = (req: ModelRequest) => req.tools.map((t) => t.name);
const reply = (tool: string, args: unknown = {}): ModelResponse => ({
  calls: [{ tool, args }],
  usage: { inTokens: 1, outTokens: 1 },
});
const make = (tools: ToolRegistry, store: MemoryEventStore, model: ScriptedModelClient): Runtime =>
  createRuntime({
    store,
    model,
    tools,
    capabilities: () => ({
      // biome-ignore lint/suspicious/noExplicitAny: the fake tools never touch these
      fs: {} as any,
      // biome-ignore lint/suspicious/noExplicitAny: the fake tools never touch these
      net: {} as any,
      secrets: { get: () => undefined },
    }),
    sleep: async () => {},
    random: () => 0,
  });

describe('tool selection in the runtime', () => {
  it('changes nothing without selectable tools', async () => {
    const model = new ScriptedModelClient([reply('finish', { answer: 'ok' })]);
    const rt = make(new ToolRegistry(builtin()), new MemoryEventStore(), model);
    await rt.advance(await rt.start('hi', config));
    expect(names(model.requests[0] as ModelRequest)).toEqual(['finish', 'ask_user', 'read_file']);
  });

  it('offers everything at or under the threshold, with no find_tools', async () => {
    const model = new ScriptedModelClient([reply('finish', { answer: 'ok' })]);
    const reg = new ToolRegistry([...builtin(), ...mcpTools().slice(0, 12)]);
    const rt = make(reg, new MemoryEventStore(), model);
    await rt.advance(await rt.start('hi', config));
    expect(names(model.requests[0] as ModelRequest)).toHaveLength(15);
    expect(names(model.requests[0] as ModelRequest)).not.toContain('find_tools');
  });

  it('offers a small relevant set from 30 tools, plus find_tools', async () => {
    const model = new ScriptedModelClient([reply('finish', { answer: 'ok' })]);
    const rt = make(new ToolRegistry([...builtin(), ...mcpTools()]), new MemoryEventStore(), model);
    await rt.advance(await rt.start('create a github issue about the crash', config));
    const offered = names(model.requests[0] as ModelRequest);
    expect(offered).toContain('github__create_issue');
    expect(offered).toContain('find_tools');
    expect(offered).toEqual(expect.arrayContaining(['finish', 'ask_user', 'read_file']));
    expect(offered.length).toBeLessThanOrEqual(3 + 1 + 12);
  });

  it('runs find_tools, then offers what it found, even after a restart', async () => {
    const store = new MemoryEventStore();
    const ran: string[] = [];
    const reg = () => new ToolRegistry([...builtin(), ...mcpTools((n) => ran.push(n))]);
    const first = new ScriptedModelClient([
      reply('find_tools', { query: 'share a file' }),
      // The task stops here, as if the process went away; a new runtime picks it up.
      reply('ask_user', { question: 'Which file?' }),
    ]);
    const rt1 = make(reg(), store, first);
    const id = await rt1.start('tidy up the quarterly numbers', config);
    expect(await rt1.advance(id)).toMatchObject({ status: 'waiting_user' });
    expect(names(first.requests[0] as ModelRequest)).not.toContain('drive__share_file');
    expect(names(first.requests[1] as ModelRequest)).toContain('drive__share_file');

    // A fresh runtime and registry resume from the events alone.
    const second = new ScriptedModelClient([
      reply('drive__share_file'),
      reply('finish', { answer: 'done' }),
    ]);
    const rt2 = make(reg(), store, second);
    await rt2.answer(id, 'the budget');
    const out = await rt2.advance(id);
    expect(out).toMatchObject({ status: 'succeeded' });
    expect(names(second.requests[0] as ModelRequest)).toContain('drive__share_file');
    expect(ran).toEqual(['drive__share_file']);
  });

  it('lets a hidden tool run when the model calls it by name', async () => {
    const ran: string[] = [];
    const model = new ScriptedModelClient([
      reply('calendar__list_events'),
      reply('finish', { answer: 'done' }),
    ]);
    const rt = make(
      new ToolRegistry([...builtin(), ...mcpTools((n) => ran.push(n))]),
      new MemoryEventStore(),
      model,
    );
    await rt.advance(await rt.start('create a github issue', config));
    expect(names(model.requests[0] as ModelRequest)).not.toContain('calendar__list_events');
    expect(ran).toEqual(['calendar__list_events']);
  });

  it('hints at find_tools only when a subset is on offer', async () => {
    const few = new ScriptedModelClient([reply('finish', { answer: 'ok' })]);
    const small = new ToolRegistry([...builtin(), ...mcpTools().slice(0, 12)]);
    const rtSmall = make(small, new MemoryEventStore(), few);
    await rtSmall.advance(await rtSmall.start('hi', config));
    expect((few.requests[0] as ModelRequest).system).not.toContain('find_tools');

    const many = new ScriptedModelClient([reply('finish', { answer: 'ok' })]);
    const rtMany = make(
      new ToolRegistry([...builtin(), ...mcpTools()]),
      new MemoryEventStore(),
      many,
    );
    await rtMany.advance(await rtMany.start('hi', config));
    expect((many.requests[0] as ModelRequest).system).toContain('find_tools');

    // Allowed tools without find_tools: the model cannot use it, so the prompt does not mention it.
    const locked = new ScriptedModelClient([reply('finish', { answer: 'ok' })]);
    const rtLocked = make(
      new ToolRegistry([...builtin(), ...mcpTools()]),
      new MemoryEventStore(),
      locked,
    );
    const id = await rtLocked.start('hi', {
      ...config,
      permissions: { autoApprove: ['read'], allowTools: ['finish'] },
    });
    await rtLocked.advance(id);
    expect((locked.requests[0] as ModelRequest).system).not.toContain('find_tools');
  });

  it('find_tools does not list tools the task denies or does not allow', async () => {
    const found = async (permissions: TaskConfig['permissions']) => {
      const model = new ScriptedModelClient([
        reply('find_tools', { query: 'delete file' }),
        reply('finish', { answer: 'ok' }),
      ]);
      const store = new MemoryEventStore();
      const rt = make(new ToolRegistry([...builtin(), ...mcpTools()]), store, model);
      const id = await rt.start('tidy up', { ...config, permissions });
      await rt.advance(id);
      const call = Object.values(fold(await store.read(id)).calls).find(
        (c) => c.tool === 'find_tools',
      );
      return call?.result?.ok ? call.result.content : '';
    };
    expect(await found({ autoApprove: ['read'] })).toContain('drive__delete_file');
    const denied = await found({ autoApprove: ['read'], denyTools: ['drive__delete_file'] });
    expect(denied).not.toContain('drive__delete_file');
    expect(denied).toContain('calendar__delete_event');
    const allowed = await found({
      autoApprove: ['read'],
      allowTools: ['find_tools', 'finish', 'calendar__delete_event'],
    });
    expect(allowed).not.toContain('drive__delete_file');
    expect(allowed).toContain('calendar__delete_event');
  });
});
