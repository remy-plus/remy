// Mock chats: two sample conversations, and a new message that gets a finished turn a moment later.
// Mock-only; `remy serve` answers the same methods from chats.json and the task events.
import type { ChatSent, ChatSummary, ChatTurn, ChatView, RemyApi } from './types.ts';

type ChatsApi = Pick<
  RemyApi,
  'listChats' | 'getChat' | 'sendMessage' | 'renameChat' | 'deleteChat'
>;

interface MockChat {
  id: string;
  title: string;
  updatedAt: string;
  turns: ChatTurn[];
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

const seeds = (): MockChat[] => [
  {
    // A turn that is waiting on the "Draft a correction to Dana" job in mock.ts, so the live turn and its
    // approval card can be seen in the demo.
    id: 'chat_dana',
    title: 'Correction to Dana',
    updatedAt: ago(2),
    turns: [
      {
        taskId: 'task_correction',
        prompt: 'Send Dana a correction on the Q3 vendor total',
        state: 'waiting',
        at: ago(2),
      },
    ],
  },
  {
    id: 'chat_week',
    title: 'Plan my week',
    updatedAt: ago(35),
    turns: [
      {
        taskId: 'task_mockchat1',
        prompt: 'Plan my week around the dentist on Tuesday',
        state: 'done',
        answer:
          'Monday and Wednesday are open for deep work. I kept Tuesday afternoon free after the dentist and moved the team sync to Thursday.',
        at: ago(40),
      },
      {
        taskId: 'task_mockchat2',
        prompt: 'Block two hours on Wednesday morning',
        state: 'done',
        answer: 'Wednesday 09:00 to 11:00 is blocked as focus time.',
        at: ago(35),
      },
    ],
  },
  {
    id: 'chat_flights',
    title: 'Flights to Lisbon in March',
    updatedAt: ago(26 * 60),
    turns: [
      {
        taskId: 'task_mockchat3',
        prompt: 'Find flights to Lisbon in March under 200 pounds',
        state: 'done',
        answer: 'The cheapest direct return is 142 pounds on 14 March, back on 18 March.',
        at: ago(26 * 60),
      },
    ],
  },
];

const words = (text: string, max: number) => {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

const stateOf = (c: MockChat): ChatSummary['state'] => {
  if (c.turns.some((t) => t.state === 'waiting')) return 'waiting';
  return c.turns.some((t) => t.state === 'working') ? 'working' : 'resting';
};

export function createChatsMock(delayMs = 400): ChatsApi {
  const chats = new Map<string, MockChat>(seeds().map((c) => [c.id, c]));
  let counter = 0;
  const need = (id: string) => {
    const c = chats.get(id);
    if (!c) throw new Error('There is no such chat.');
    return c;
  };
  const view = (c: MockChat): ChatView => ({
    id: c.id,
    title: c.title,
    turns: c.turns.map((t) => ({ ...t })),
  });
  const summary = (c: MockChat): ChatSummary => {
    const last = c.turns.at(-1);
    return {
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      preview: last ? words(last.answer ?? last.prompt, 120) : '',
      state: stateOf(c),
    };
  };
  const created = (text: string): MockChat => ({
    id: `chat_mock${++counter}`,
    title: words(text, 48).replace(/[.!?,;:…]+$/, ''),
    updatedAt: '',
    turns: [],
  });
  return {
    async listChats() {
      return [...chats.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(summary);
    },
    async getChat(id) {
      return view(need(id));
    },
    async sendMessage(text, chatId): Promise<ChatSent> {
      const chat = chatId === undefined ? created(text) : need(chatId);
      const turn: ChatTurn = {
        taskId: `task_mockchat_new${++counter}`,
        prompt: text,
        state: 'working',
        at: new Date().toISOString(),
      };
      chat.turns.push(turn);
      chat.updatedAt = turn.at;
      chats.set(chat.id, chat);
      setTimeout(() => {
        turn.state = 'done';
        turn.answer = `Done. I looked into "${words(text, 60)}" and have nothing that needs your decision.`;
      }, delayMs);
      return { chatId: chat.id, taskId: turn.taskId };
    },
    async renameChat(id, title) {
      need(id).title = title;
    },
    async deleteChat(id) {
      need(id);
      chats.delete(id);
    },
  };
}
