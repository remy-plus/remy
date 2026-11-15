import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import type { CallView, ChatTurn, RemyApi, TaskView } from '../../api/types.ts';
import { Chat } from './Chat.tsx';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  window.location.hash = '';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const show = (api: RemyApi, id?: string) =>
  render(
    <ApiProvider api={api}>
      <Chat {...(id && { id })} />
    </ApiProvider>,
  );

const turn = (over: Partial<ChatTurn>): ChatTurn => ({
  taskId: 'task_x',
  prompt: 'Do the thing',
  state: 'done',
  at: new Date().toISOString(),
  ...over,
});

const call = (over: Partial<CallView> & { args?: unknown }): CallView => ({
  callId: 'call_1',
  tool: 'read_file',
  step: 1,
  argsHash: 'hash_abc',
  attempts: 1,
  inFlight: false,
  ...over,
});

/** The mock with one chat whose turns and jobs are set here. */
function withChat(turns: ChatTurn[], tasks: Record<string, TaskView> = {}): RemyApi {
  const base = createMockApi();
  return {
    ...base,
    getChat: async (id) => ({ id, title: 'Test chat', turns }),
    getTask: async (id) => {
      const t = tasks[id];
      if (!t) throw new Error('no such job');
      return t;
    },
  };
}

const jobOf = async (over: Partial<TaskView>): Promise<TaskView> => ({
  ...(await createMockApi().getTask('task_correction')),
  ...over,
});

describe('empty chat', () => {
  it('offers to carry on with the newest chat, and says what Remy will not do unasked', async () => {
    show(createMockApi());
    const link = await screen.findByRole('link', { name: /Pick up where you left off/ });
    expect(link.getAttribute('href')).toMatch(/^#\/chat\//);
    expect(screen.getByText(/asks before it sends anything as you or spends money/)).toBeTruthy();
  });

  it('shows the greeting, a labelled box and the suggestions', () => {
    show(createMockApi());
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Good|Still up/);
    expect(screen.getByText('What do you need?')).toBeTruthy();
    expect(screen.getByLabelText('Ask Remy to do anything')).toBeTruthy();
    expect(screen.getAllByRole('list')[0]?.querySelectorAll('button')).toHaveLength(4);
  });

  it('a suggestion fills the box', () => {
    show(createMockApi());
    const chip = screen.getByRole('button', { name: /Lisbon/ });
    fireEvent.click(chip);
    expect((screen.getByLabelText('Ask Remy to do anything') as HTMLTextAreaElement).value).toBe(
      chip.textContent,
    );
  });

  it('Enter sends and opens the chat; Shift+Enter does not send', async () => {
    const api = createMockApi();
    const send = vi.spyOn(api, 'sendMessage');
    show(api);
    const box = screen.getByLabelText('Ask Remy to do anything');
    fireEvent.change(box, { target: { value: 'Book a table' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(send).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(send).toHaveBeenCalledWith('Book a table', undefined));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/chat\/chat_mock/));
  });

  it('the mic button says so when the browser cannot listen', async () => {
    show(createMockApi());
    fireEvent.click(screen.getByRole('button', { name: 'Talk to Remy' }));
    expect(await screen.findByText("This browser can't listen. You can still type.")).toBeTruthy();
  });
});

describe('polling', () => {
  /** A chat with one live turn. `stream` is how the job's event stream behaves. */
  async function live(stream: RemyApi['streamTask']) {
    const task = await jobOf({ status: 'running', running: true, calls: [] });
    const base = withChat([turn({ taskId: 'task_live', state: 'working' })], { task_live: task });
    const getChat = vi.fn(base.getChat);
    return { api: { ...base, getChat, streamTask: stream }, getChat };
  }
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  it('does not ask for the chat every two seconds while the event stream is open', async () => {
    vi.useFakeTimers();
    try {
      const { api, getChat } = await live(
        (_id, _on, o) =>
          new Promise<void>((resolve) => {
            o?.onOpen?.();
            o?.signal?.addEventListener('abort', () => resolve());
          }),
      );
      show(api, 'c1');
      await advance(100);
      const first = getChat.mock.calls.length;
      await advance(10000);
      expect(getChat.mock.calls.length).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks again every two seconds when the stream is not up', async () => {
    vi.useFakeTimers();
    try {
      const { api, getChat } = await live(() => Promise.reject(new Error('dropped')));
      show(api, 'c1');
      await advance(100);
      const first = getChat.mock.calls.length;
      await advance(6000);
      expect(getChat.mock.calls.length).toBeGreaterThanOrEqual(first + 2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not ask while the tab is hidden', async () => {
    vi.useFakeTimers();
    try {
      const { api, getChat } = await live(() => Promise.reject(new Error('dropped')));
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      show(api, 'c1');
      await advance(100);
      const first = getChat.mock.calls.length;
      await advance(10000);
      expect(getChat.mock.calls.length).toBe(first);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('chat view', () => {
  it('names what it is opening instead of saying "Loading"', () => {
    const api = { ...createMockApi(), getChat: () => new Promise<never>(() => {}) };
    show(api, 'c1');
    expect(screen.getByText('Opening your chat')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/^Loading$/);
  });

  it('lists the turns with their answers', async () => {
    show(createMockApi(), 'chat_week');
    expect(await screen.findByText('Plan my week around the dentist on Tuesday')).toBeTruthy();
    expect(screen.getByText('Block two hours on Wednesday morning')).toBeTruthy();
    expect(screen.getByText(/Monday and Wednesday are open/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Copy' })).toHaveLength(2);
  });

  it('shows the Mind only on a live turn, not beside finished answers', async () => {
    show(createMockApi(), 'chat_week');
    await screen.findByText(/Monday and Wednesday are open/);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    cleanup();
    show(createMockApi(), 'chat_dana');
    await screen.findByText('Send Dana a correction on the Q3 vendor total');
    await waitFor(() => expect(screen.getAllByRole('img').length).toBeGreaterThan(0));
  });

  it('folds a finished feed into "What I did" with plain lines', async () => {
    const job = await jobOf({
      status: 'succeeded',
      running: false,
      pendingApproval: undefined as never,
      calls: [
        call({
          callId: 'a',
          args: { path: 'quotes/acme.md' },
          result: { ok: true, content: 'Total 4,200', truncated: false },
        }),
        call({
          callId: 'b',
          step: 2,
          tool: 'fetch_url',
          args: { url: 'https://northwind.com/pricing' },
          result: { ok: true, content: 'Pricing page', truncated: false },
        }),
      ],
    });
    show(withChat([turn({ answer: 'All set.' })], { task_x: job }), 'c1');
    fireEvent.click(await screen.findByRole('button', { name: 'What I did (2 steps)' }));
    const log = screen.getByRole('list', { name: 'What Remy is doing' });
    // The step list is not a live region: a settled feed is never read out again.
    expect(log.getAttribute('aria-live')).toBeNull();
    expect(log.getAttribute('role')).toBeNull();
    expect(screen.getByText('Read quotes/acme.md')).toBeTruthy();
    expect(screen.getByText('Opened northwind.com')).toBeTruthy();
    expect(log.textContent).not.toMatch(/read_file|fetch_url|hash_abc/);
    fireEvent.click(screen.getByRole('button', { name: /Read quotes\/acme\.md/ }));
    expect(screen.getByText('Total 4,200')).toBeTruthy();
  });

  it('shows Try again for a failed turn and resends the message', async () => {
    const api = withChat([turn({ state: 'failed', prompt: 'Send the invoice' })]);
    const send = vi.spyOn(api, 'sendMessage');
    show(api, 'c1');
    expect(await screen.findByText("I couldn't finish that.")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('Send the invoice', 'c1'));
  });
});

describe('waiting for approval', () => {
  const card = {
    callId: 'call_9',
    argsHash: 'hash_card',
    preview: 'Send the corrected total to Dana',
    risk: 'send_as_user' as const,
    reason: 'It sends mail as you.',
  };
  const setup = async () => {
    const job = await jobOf({
      status: 'waiting_approval',
      running: true,
      pendingApproval: card,
      calls: [call({ callId: 'call_9', tool: 'run_command' })],
    });
    const api = withChat([turn({ state: 'waiting' })], { task_x: job });
    const approve = vi.spyOn(api, 'approve').mockResolvedValue();
    show(api, 'c1');
    await screen.findByText('Send the corrected total to Dana');
    return approve;
  };

  it('tells a screen reader, politely and once, that Remy needs an OK', async () => {
    await setup();
    const said = screen
      .getAllByRole('status')
      .find((el) => /Remy needs your OK/.test(el.textContent ?? ''));
    expect(said?.textContent).toBe('Remy needs your OK. Send the corrected total to Dana');
    expect(said?.classList.contains('sr-only')).toBe(true);
  });

  it('Approve sends the card hash', async () => {
    const approve = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith('task_x', {
        callId: 'call_9',
        argsHash: 'hash_card',
        granted: true,
      }),
    );
  });

  it('says what happens next, then confirms the answer', async () => {
    await setup();
    expect(screen.getByText('Remy carries on as soon as you answer.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Approved. Remy is carrying on.')).toBeTruthy();
  });

  it('answers once, even if Enter is pressed again', async () => {
    const approve = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText('Approved. Remy is carrying on.');
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(approve).toHaveBeenCalledTimes(1);
  });

  it('Not now declines with the same hash', async () => {
    const approve = await setup();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith('task_x', {
        callId: 'call_9',
        argsHash: 'hash_card',
        granted: false,
      }),
    );
  });

  it('Esc declines', async () => {
    const approve = await setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith('task_x', expect.objectContaining({ granted: false })),
    );
  });
});

describe('a running turn', () => {
  it('shows Stop, cancels the job, and queues a message typed meanwhile', async () => {
    const job = await jobOf({
      status: 'running',
      running: true,
      pendingApproval: undefined as never,
      calls: [call({ inFlight: true, args: { path: 'reply.md' }, tool: 'write_file' })],
    });
    const api = withChat([turn({ state: 'working' })], { task_x: job });
    const cancel = vi.spyOn(api, 'cancel').mockResolvedValue();
    const send = vi.spyOn(api, 'sendMessage');
    show(api, 'c1');
    expect(await screen.findByText('Writing reply.md')).toBeTruthy();
    const box = screen.getByLabelText('Ask Remy to do anything');
    fireEvent.change(box, { target: { value: 'Then email it' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByText(/Then email it/)).toBeTruthy();
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('task_x'));
  });
});
