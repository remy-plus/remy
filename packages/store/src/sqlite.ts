import { DatabaseSync } from 'node:sqlite';
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, status TEXT NOT NULL, prompt TEXT NOT NULL, config_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  lease_owner TEXT, lease_expires_at INTEGER, lease_ttl_ms INTEGER
);
CREATE TABLE IF NOT EXISTS events (
  task_id TEXT NOT NULL, seq INTEGER NOT NULL, at TEXT NOT NULL, type TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY (task_id, seq)
);`;

type Row = Record<string, string | number | null>;

export class SqliteEventStore implements EventStore {
  private db: DatabaseSync;
  private now: () => number;

  constructor(path: string, opts: { now?: () => number } = {}) {
    this.now = opts.now ?? Date.now;
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  private iso = () => new Date(this.now()).toISOString();

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const out = fn();
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private get(sql: string, ...args: (string | number)[]): Row | undefined {
    return this.db.prepare(sql).get(...args) as Row | undefined;
  }

  private insert(taskId: string, seq: number, at: string, event: Event): void {
    this.db
      .prepare('INSERT INTO events (task_id, seq, at, type, payload_json) VALUES (?, ?, ?, ?, ?)')
      .run(taskId, seq, at, event.type, JSON.stringify(event));
  }

  async createTask(taskId: string, prompt: string, config: TaskConfig): Promise<void> {
    const at = this.iso();
    this.tx(() => {
      this.db
        .prepare(
          'INSERT INTO tasks (id, status, prompt, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(taskId, 'running', prompt, JSON.stringify(config), at, at);
      this.insert(taskId, 1, at, { type: 'task.created', prompt, config });
    });
  }

  async read(taskId: string, fromSeq = 1): Promise<StoredEvent[]> {
    const rows = this.db
      .prepare(
        'SELECT seq, at, payload_json FROM events WHERE task_id = ? AND seq >= ? ORDER BY seq',
      )
      .all(taskId, fromSeq) as Row[];
    return rows.map((r) => ({
      taskId,
      seq: r.seq as number,
      at: r.at as string,
      event: JSON.parse(r.payload_json as string) as Event,
    }));
  }

  async append(
    taskId: string,
    expectedSeq: number,
    events: Event[],
    lease: Lease,
  ): Promise<number> {
    return this.tx(() => {
      const task = this.get(
        'SELECT status, lease_owner, lease_expires_at FROM tasks WHERE id = ?',
        taskId,
      );
      if (
        !task ||
        task.lease_owner !== lease.owner ||
        (task.lease_expires_at as number) <= this.now()
      ) {
        throw new ConcurrencyError(`lease not held for ${taskId}`);
      }
      const last =
        (this.get('SELECT MAX(seq) AS m FROM events WHERE task_id = ?', taskId)?.m as number) ?? 0;
      if (last !== expectedSeq) {
        throw new ConcurrencyError(`stale seq for ${taskId}: expected ${expectedSeq}, at ${last}`);
      }
      const at = this.iso();
      let status = task.status as TaskStatus;
      let seq = last;
      for (const event of events) {
        this.insert(taskId, ++seq, at, event);
        status = nextStatus(status, event);
      }
      this.db
        .prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, at, taskId);
      return seq;
    });
  }

  async acquireLease(taskId: string, owner: string, ttlMs: number): Promise<Lease | null> {
    const expiresAt = this.now() + ttlMs;
    const res = this.db
      .prepare(
        `UPDATE tasks SET lease_owner = ?, lease_expires_at = ?, lease_ttl_ms = ?
         WHERE id = ? AND (lease_owner IS NULL OR lease_expires_at <= ?)`,
      )
      .run(owner, expiresAt, ttlMs, taskId, this.now());
    return res.changes ? { taskId, owner, expiresAt } : null;
  }

  async renewLease(lease: Lease): Promise<boolean> {
    const res = this.db
      .prepare(
        `UPDATE tasks SET lease_expires_at = ? + lease_ttl_ms
         WHERE id = ? AND lease_owner = ? AND lease_expires_at > ?`,
      )
      .run(this.now(), lease.taskId, lease.owner, this.now());
    return res.changes > 0;
  }

  async releaseLease(lease: Lease): Promise<void> {
    this.db
      .prepare(
        'UPDATE tasks SET lease_owner = NULL, lease_expires_at = NULL WHERE id = ? AND lease_owner = ?',
      )
      .run(lease.taskId, lease.owner);
  }

  async listTasks(filter?: { status?: TaskStatus }): Promise<TaskSummary[]> {
    const rows = (
      filter?.status
        ? this.db
            .prepare('SELECT * FROM tasks WHERE status = ? ORDER BY created_at, id')
            .all(filter.status)
        : this.db.prepare('SELECT * FROM tasks ORDER BY created_at, id').all()
    ) as Row[];
    return rows.map((r) => ({
      taskId: r.id as string,
      status: r.status as TaskStatus,
      prompt: r.prompt as string,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  }
}
