// What the chat shows when the model fails: one plain sentence, and a saved task when the network drops.
import { createRuntime, DEFAULT_BUDGET, ModelError, ToolRegistry } from '@remy/core';
import { ScriptedModelClient } from '@remy/models';
import { MemoryEventStore } from '@remy/store';
import { createScopedFetch, createScopedFs, finish } from '@remy/tools';
import { describe, expect, it } from 'vitest';
import { createChat, releaseLease } from './chat.ts';

function make(errors: Error[]) {
  const store = new MemoryEventStore();
  const model = new ScriptedModelClient(errors);
  const chat = createChat({
    runtime: (hooks) =>
      createRuntime({
        store,
        model,
        tools: new ToolRegistry([finish]),
        owner: 'chat-failure',
        capabilities: (c) => ({
          fs: createScopedFs(c.workspaceDir),
          net: createScopedFetch({}),
          secrets: { get: () => undefined },
        }),
        sleep: async () => {},
        ...hooks,
      }),
    config: (context) => ({
      model: 'test',
      permissions: { autoApprove: ['read'] },
      budget: DEFAULT_BUDGET,
      workspaceDir: '/tmp',
      context,
    }),
    release: releaseLease(store, 'chat-failure'),
    listTasks: () => store.listTasks(),
    readEvents: (id) => store.read(id),
  });
  return chat;
}

describe('the chat when the model fails', () => {
  it('a dropped network pauses the turn and says the task is saved', async () => {
    const down = () => new ModelError('network error: fetch failed', true, { unreachable: true });
    const chat = make(Array.from({ length: 5 }, down));
    await chat.submit('write a file');
    const s = chat.getState();
    expect(s.phase).toBe('paused');
    const said = JSON.stringify(s.items);
    expect(said).toContain('Remy lost contact with the model');
    expect(said).toContain('The task is saved');
    expect(said).not.toMatch(/fetch failed|ECONN/);
  });

  it('a wrong key names /login and shows no raw body', async () => {
    const chat = make([
      new ModelError('HTTP 401: {"error":{"message":"Incorrect API key provided: sk-abc"}}', false),
    ]);
    await chat.submit('write a file');
    const said = JSON.stringify(chat.getState().items);
    expect(said).toContain('The key was rejected. Run /login to replace it.');
    expect(said).not.toMatch(/sk-abc|HTTP 401/);
  });

  it('a model that keeps calling a tool that does not exist stops with a plain sentence', async () => {
    const chat = make(
      Array.from(
        { length: 5 },
        () =>
          new ModelError(
            'tool call still invalid after 2 retries: Unknown tool "nope". Available tools: finish',
            true,
          ),
      ),
    );
    await chat.submit('write a file');
    const said = JSON.stringify(chat.getState().items);
    expect(said).toContain('kept asking for something Remy cannot do');
    expect(said).not.toContain('Available tools');
  });
});
