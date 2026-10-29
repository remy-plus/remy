// The one ongoing conversation: which tasks it is made of and where its files live, so `remy`
// opens where the user left off. Turns are rebuilt from the tasks' own events; this file only
// holds their ids. REMY_HOME/conversation.json, owner-only.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type ConversationTurn, fold, type StoredEvent } from '@remy/core';
import { z } from 'zod';

/** Ids kept on file; older turns are past what the chat would send anyway. */
export const MAX_SAVED_TASKS = 40;

const Saved = z.object({
  version: z.literal(1),
  workspace: z.string().min(1),
  tasks: z.array(z.string().regex(/^task_[0-9a-f]+$/)),
  updatedAt: z.string(),
});
export type SavedConversation = z.infer<typeof Saved>;

export interface ConversationStore {
  /** The saved conversation, or undefined when there is none or the file is damaged. */
  load(): SavedConversation | undefined;
  /** Adds a finished turn's task. */
  add(taskId: string): void;
  /** Starts again in `workspace`, forgetting the turns (their tasks stay in the store). */
  reset(workspace: string): void;
}

export function openConversation(home: string, now = () => new Date()): ConversationStore {
  const path = join(home, 'conversation.json');
  let damaged = false;

  function load(): SavedConversation | undefined {
    if (!existsSync(path)) return undefined;
    try {
      const parsed = Saved.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      if (parsed.success) return parsed.data;
    } catch {
      // Unreadable: treated like a damaged file.
    }
    damaged = true;
    return undefined;
  }

  function save(c: SavedConversation) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    // A damaged file is moved aside, never silently overwritten.
    if (damaged && existsSync(path)) renameSync(path, `${path}.damaged`);
    damaged = false;
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  }

  return {
    load,
    add(taskId) {
      const c = load();
      if (!c) return;
      const tasks = [...c.tasks.filter((t) => t !== taskId), taskId].slice(-MAX_SAVED_TASKS);
      save({ ...c, tasks, updatedAt: now().toISOString() });
    },
    reset(workspace) {
      load();
      save({ version: 1, workspace, tasks: [], updatedAt: now().toISOString() });
    },
  };
}

/** A finished task as a chat turn: the user's prompt and Remy's answer. Undefined unless it succeeded. */
export function turnOf(events: StoredEvent[]): ConversationTurn | undefined {
  if (!events.length) return undefined;
  const s = fold(events);
  const end = events.findLast((e) => e.event.type === 'task.finished')?.event;
  if (s.status !== 'succeeded' || end?.type !== 'task.finished') return undefined;
  const pasted = s.config.pasted;
  return {
    prompt: s.prompt,
    answer: end.answer?.trim() || 'Done.',
    ...(pasted?.length && { pasted }),
  };
}

/** The saved conversation's turns, oldest first, skipping tasks that are gone or did not succeed. */
export async function savedTurns(
  c: SavedConversation,
  readEvents: (taskId: string) => Promise<StoredEvent[]>,
): Promise<{ taskId: string; turn: ConversationTurn }[]> {
  const out: { taskId: string; turn: ConversationTurn }[] = [];
  for (const taskId of c.tasks) {
    const turn = turnOf(await readEvents(taskId));
    if (turn) out.push({ taskId, turn });
  }
  return out;
}
