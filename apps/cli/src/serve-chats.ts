// Chats for the web app: a chat is a title and an ordered list of task ids, kept in
// REMY_HOME/chats.json (0600, written atomically; a damaged file means no chats). The words live in
// the tasks, so a chat view is built from their events. A new message starts a task whose context
// is the chat's earlier finished turns, so the model sees the conversation. Deleting a chat only
// removes this record: its jobs stay in Activity.
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type ConversationTurn,
  type EventStore,
  fold,
  isTrustLevel,
  type TaskState,
} from '@remy/core';
import { z } from 'zod';
import { cleanText } from './review.ts';
import {
  type ApiCtx,
  type ApiResult,
  type ApiRoute,
  HttpError,
  PROMPT_MAX_CHARS,
} from './serve.ts';
import { ID_RE } from './serve-mount.ts';
import { type Redact, redactDeep } from './serve-view.ts';

export const TITLE_MAX = 48;
const RENAME_MAX = 120;
const PREVIEW_MAX = 120;
export const CONTEXT_TURNS = 10;
export const CONTEXT_CHARS = 8000;

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  taskIds: string[];
}

const chatShape = z.object({
  id: z.string().regex(ID_RE),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  taskIds: z.array(z.string()),
});
const fileShape = z.object({ chats: z.array(chatShape) });

export interface ChatStore {
  list(): Chat[];
  get(id: string): Chat | undefined;
  create(title: string, taskId: string): Chat;
  append(id: string, taskId: string): Chat | undefined;
  rename(id: string, title: string): Chat | undefined;
  remove(id: string): boolean;
}

/** A short plain phrase from a first message: one line, at a word boundary, no trailing marks. */
export function titleFrom(text: string): string {
  const one = cleanText(text, 10_000);
  if (!one) return 'New chat';
  let cut = one;
  if (one.length > TITLE_MAX) {
    const room = one.slice(0, TITLE_MAX + 1);
    const space = room.lastIndexOf(' ');
    cut = space > TITLE_MAX / 2 ? room.slice(0, space) : one.slice(0, TITLE_MAX);
  }
  return cut.replace(/[\s.,;:!?\-–—…]+$/u, '') || 'New chat';
}

export function openChats(home: string, now: () => Date = () => new Date()): ChatStore {
  const file = join(home, 'chats.json');
  const read = (): Chat[] => {
    try {
      const parsed = fileShape.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      return parsed.success ? parsed.data.chats : [];
    } catch {
      return [];
    }
  };
  const write = (chats: Chat[]) => {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ chats }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  };
  const change = (id: string, fn: (c: Chat) => Chat): Chat | undefined => {
    const chats = read();
    const at = chats.findIndex((c) => c.id === id);
    if (at < 0) return undefined;
    const next = fn(chats[at] as Chat);
    chats[at] = next;
    write(chats);
    return next;
  };
  const stamp = () => now().toISOString();
  return {
    list: read,
    get: (id) => read().find((c) => c.id === id),
    create(title, taskId) {
      const at = stamp();
      const chat: Chat = {
        id: `chat_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
        title,
        createdAt: at,
        updatedAt: at,
        taskIds: [taskId],
      };
      write([...read(), chat]);
      return chat;
    },
    append: (id, taskId) =>
      change(id, (c) => ({ ...c, updatedAt: stamp(), taskIds: [...c.taskIds, taskId] })),
    rename: (id, title) => change(id, (c) => ({ ...c, title })),
    remove(id) {
      const chats = read();
      const next = chats.filter((c) => c.id !== id);
      if (next.length === chats.length) return false;
      write(next);
      return true;
    },
  };
}

export interface ChatDeps {
  home: string;
  store: EventStore;
  redact?: Redact;
  chats?: ChatStore;
}

type TurnState = 'working' | 'waiting' | 'done' | 'failed' | 'stopped';
type ChatState = 'working' | 'waiting' | 'resting';

const turnState = (s: TaskState): TurnState => {
  if (s.status === 'succeeded') return 'done';
  if (s.status === 'failed') return 'failed';
  if (s.status === 'cancelled') return 'stopped';
  return s.status === 'waiting_approval' || s.status === 'waiting_user' ? 'waiting' : 'working';
};

const chatState = (turns: TurnState[]): ChatState =>
  turns.includes('waiting') ? 'waiting' : turns.includes('working') ? 'working' : 'resting';

/** Earlier finished turns, oldest first: at most CONTEXT_TURNS and CONTEXT_CHARS in all. */
export function contextFrom(states: TaskState[]): ConversationTurn[] {
  const done = states.filter((s) => s.status === 'succeeded' && s.final?.answer);
  const kept: ConversationTurn[] = [];
  let room = CONTEXT_CHARS;
  for (const s of done.reverse().slice(0, CONTEXT_TURNS)) {
    const prompt = s.prompt.slice(0, room);
    const answer = (s.final?.answer ?? '').slice(0, Math.max(0, room - prompt.length));
    if (!prompt && !answer) break;
    kept.push({ prompt, answer });
    room -= prompt.length + answer.length;
    if (room <= 0) break;
  }
  return kept.reverse();
}

/** Whether an earlier turn that goes into the context read untrusted content. */
export function contextTainted(states: TaskState[]): boolean {
  return states
    .filter((s) => s.status === 'succeeded' && s.final?.answer)
    .slice(-CONTEXT_TURNS)
    .some((s) => s.tainted);
}

const messageBody = z
  .object({
    chatId: z.string().max(100).optional(),
    text: z.string().trim().min(1).max(PROMPT_MAX_CHARS),
    trust: z.string().optional(),
  })
  .strict();
const renameBody = z.object({ title: z.string().trim().min(1).max(RENAME_MAX) }).strict();

const NOT_FOUND = new HttpError(404, 'There is no such chat.');
const json = (status: number, body: unknown): ApiResult => ({ status, body });

export function chatRoutes(d: ChatDeps): ApiRoute {
  const chats = d.chats ?? openChats(d.home);
  const redact: Redact = d.redact ?? ((t) => t);

  const states = async (c: Chat): Promise<TaskState[]> => {
    const out: TaskState[] = [];
    for (const id of c.taskIds) {
      const events = await d.store.read(id);
      if (events.length) out.push(fold(events));
    }
    return out;
  };

  const summary = async (c: Chat) => {
    const all = await states(c);
    const last = all.at(-1);
    const words = last ? (last.final?.answer ?? last.prompt) : '';
    return {
      id: c.id,
      title: c.title,
      updatedAt: c.updatedAt,
      preview: cleanText(words, PREVIEW_MAX),
      state: chatState(all.map(turnState)),
    };
  };

  const view = async (c: Chat) => ({
    id: c.id,
    title: c.title,
    turns: (await states(c)).map((s) => {
      const answer = s.status === 'succeeded' ? s.final?.answer : undefined;
      return {
        taskId: s.taskId,
        prompt: s.prompt,
        state: turnState(s),
        ...(answer !== undefined && { answer }),
        at: new Date(s.createdAt).toISOString(),
      };
    }),
  });

  const need = (id: string | undefined): Chat => {
    const found = id && ID_RE.test(id) ? chats.get(id) : undefined;
    if (!found) throw NOT_FOUND;
    return found;
  };

  async function send(ctx: ApiCtx): Promise<ApiResult> {
    const body = await ctx.body(messageBody);
    if (body.trust !== undefined && !isTrustLevel(body.trust))
      throw new HttpError(400, 'trust must be ask, steady or away.');
    const chat = body.chatId === undefined ? undefined : need(body.chatId);
    const earlier = chat ? await states(chat) : undefined;
    const context = earlier ? contextFrom(earlier) : undefined;
    // An earlier answer that read untrusted content may carry an injected instruction forward.
    const tainted = earlier ? contextTainted(earlier) : false;
    const { taskId } = await ctx.startTask(body.text, body.trust, context, tainted);
    const saved = chat ? chats.append(chat.id, taskId) : chats.create(titleFrom(body.text), taskId);
    if (!saved) throw NOT_FOUND;
    return json(201, { chatId: saved.id, taskId });
  }

  async function one(ctx: ApiCtx, id: string): Promise<ApiResult> {
    if (ctx.method === 'GET') return json(200, await view(need(id)));
    if (ctx.method === 'PUT') {
      const { title } = await ctx.body(renameBody);
      need(id);
      if (!chats.rename(id, title)) throw NOT_FOUND;
      return json(200, await view(need(id)));
    }
    if (ctx.method === 'DELETE') {
      need(id);
      chats.remove(id);
      return json(200, { ok: true });
    }
    return { status: 405, headers: { allow: 'GET, PUT, DELETE' } };
  }

  async function handle(ctx: ApiCtx): Promise<ApiResult | undefined> {
    const [head, id] = ctx.parts;
    if (head !== 'chats' || ctx.parts.length > 2) return undefined;
    if (id === undefined || id === '') {
      if (ctx.method !== 'GET') return { status: 405, headers: { allow: 'GET' } };
      const all = await Promise.all(
        [...chats.list()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).map(summary),
      );
      return json(200, { chats: all });
    }
    if (id === 'messages') {
      if (ctx.method !== 'POST') return { status: 405, headers: { allow: 'POST' } };
      return send(ctx);
    }
    return one(ctx, id);
  }

  return async (ctx) => {
    const r = await handle(ctx);
    return r?.body === undefined ? r : { ...r, body: redactDeep(r.body, redact) };
  };
}
