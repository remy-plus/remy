import {
  ConcurrencyError,
  type Event,
  type EventStore,
  type Lease,
  type StoredEvent,
  type TaskConfig,
  type TaskStatus,
  type TaskSummary,
} from '@remy/core';
import { nextStatus } from './status.ts';

interface Row {
  summary: TaskSummary;
  events: StoredEvent[];
  owner: string | null;
  expiresAt: number;
  ttlMs: number;
}

export class MemoryEventStore implements EventStore {
  private tasks = new Map<string, Row>();
  private now: () => number;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
  }

  private iso = () => new Date(this.now()).toISOString();

  private held(row: Row | undefined, lease: Lease): row is Row {
    return !!row && row.owner === lease.owner && row.expiresAt > this.now();
  }

  async createTask(taskId: string, prompt: string, config: TaskConfig): Promise<void> {
    if (this.tasks.has(taskId)) throw new Error(`task exists: ${taskId}`);
    const at = this.iso();
    this.tasks.set(taskId, {
      summary: { taskId, status: 'running', prompt, createdAt: at, updatedAt: at },
      events: [{ taskId, seq: 1, at, event: { type: 'task.created', prompt, config } }],
      owner: null,
      expiresAt: 0,
      ttlMs: 0,
    });
  }

  async read(taskId: string, fromSeq = 1): Promise<StoredEvent[]> {
    return (this.tasks.get(taskId)?.events ?? []).filter((e) => e.seq >= fromSeq);
  }

  async append(
    taskId: string,
    expectedSeq: number,
    events: Event[],
    lease: Lease,
  ): Promise<number> {
    const row = this.tasks.get(taskId);
    if (!this.held(row, lease)) throw new ConcurrencyError(`lease not held for ${taskId}`);
    if (row.events.length !== expectedSeq) {
      throw new ConcurrencyError(
        `stale seq for ${taskId}: expected ${expectedSeq}, at ${row.events.length}`,
      );
    }
    const at = this.iso();
    for (const event of events) {
      row.events.push({ taskId, seq: row.events.length + 1, at, event });
      row.summary.status = nextStatus(row.summary.status, event);
    }
    row.summary.updatedAt = at;
    return row.events.length;
  }

  async acquireLease(taskId: string, owner: string, ttlMs: number): Promise<Lease | null> {
    const row = this.tasks.get(taskId);
    if (!row || (row.owner && row.expiresAt > this.now())) return null;
    Object.assign(row, { owner, ttlMs, expiresAt: this.now() + ttlMs });
    return { taskId, owner, expiresAt: row.expiresAt };
  }

  async renewLease(lease: Lease): Promise<boolean> {
    const row = this.tasks.get(lease.taskId);
    if (!this.held(row, lease)) return false;
    row.expiresAt = this.now() + row.ttlMs;
    return true;
  }

  async releaseLease(lease: Lease): Promise<void> {
    const row = this.tasks.get(lease.taskId);
    if (row?.owner === lease.owner) Object.assign(row, { owner: null, expiresAt: 0 });
  }

  async listTasks(filter?: { status?: TaskStatus }): Promise<TaskSummary[]> {
    return [...this.tasks.values()]
      .map((r) => ({ ...r.summary }))
      .filter((t) => !filter?.status || t.status === filter.status);
  }
}
