// What the web app knows about `remy serve`. These types mirror the JSON that apps/cli/src/serve.ts
// and serve-view.ts send; the web app depends on no workspace package, so they are written out here.
// If a shape there changes, change it here and in the mock.

export type TaskStatus =
  | 'running'
  | 'waiting_approval'
  | 'waiting_user'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type TrustLevel = 'ask' | 'steady' | 'away';
export type Risk = 'read' | 'write' | 'send_as_user' | 'spend_money' | 'irreversible';

/** GET /api/tasks -> { tasks: TaskListItem[] }. Newest activity first. */
export interface TaskListItem {
  id: string;
  prompt: string;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  costUsd: number;
}

export interface ApprovalCard {
  callId: string;
  argsHash: string;
  preview: string;
  risk: Risk;
  reason: string;
  parked?: number;
}

export interface CallView {
  callId: string;
  tool: string;
  step: number;
  argsHash: string;
  risk?: Risk;
  attempts: number;
  inFlight: boolean;
  lastError?: string;
  result?: { ok: true; content: string; truncated: boolean } | { ok: false; error: string };
}

/** GET /api/tasks/:id. Strings are text, never markup: render them as text. */
export interface TaskView {
  taskId: string;
  prompt: string;
  status: TaskStatus;
  seq: number;
  step: number;
  createdAt: string;
  costUsd: number;
  tainted: boolean;
  config: {
    model: string;
    trust: TrustLevel;
    budget: { maxSteps: number; maxCostUsd: number; maxWallMs: number };
  };
  pendingApproval?: ApprovalCard;
  pendingQuestion?: { question: string; callId?: string };
  pause?: { limit: 'steps' | 'cost' | 'time'; steps: number; costUsd: number; elapsedMs: number };
  held?: { summary: string };
  final?: { status: 'succeeded' | 'failed' | 'cancelled'; answer?: string; reason?: string };
  calls: CallView[];
  running: boolean;
}

/** One line of GET /api/tasks/:id/stream (server-sent events; `id:` is `seq`). */
export interface StreamEvent {
  seq: number;
  at: string;
  event: { type: string; [key: string]: unknown };
}

export interface ApproveBody {
  callId: string;
  argsHash: string;
  granted: boolean;
  note?: string;
  always?: boolean;
}
export interface ExtendBody {
  steps?: number;
  costUsd?: number;
  wallMs?: number;
}

/** What the Home screen shows. The server does not serve this yet: the http adapter builds what it
 * can from the task routes and leaves the rest empty. */
export interface HomeData {
  status: {
    running: number;
    machinesUp: number | null;
    notes: number | null;
    trust: TrustLevel;
    quiet: boolean;
    time: string;
  };
  briefing: { headline: string; rest: string; stats: string[]; asks: string[] };
  satellites: { label: string }[];
  needsYou: NeedCard[];
  working: WorkItem[];
  noticed: Notice[];
  /** A notice about a connection that needs attention, shown under Needs you. */
  alert: { text: string; action: string } | null;
  brain: {
    notes: number;
    newToday: number;
    connected: { name: string; links: number }[];
  } | null;
}
export interface NeedCard {
  taskId: string;
  kind: string;
  title: string;
  detail: string;
  /** Set when the card is an approval: the buttons act on this call. */
  approval?: { callId: string; argsHash: string; approve: string; decline: string };
  review?: string;
  others?: number;
  waiting?: string;
}
export interface WorkItem {
  taskId: string;
  title: string;
  state: string;
  done: number;
  total: number;
  line: string;
}
export interface Notice {
  at: string;
  text: string;
}

/** Everything the screens may ask of the server. Components use this and nothing else. */
export interface RemyApi {
  readonly kind: 'mock' | 'http';
  listTasks(q?: { status?: TaskStatus; limit?: number }): Promise<TaskListItem[]>;
  startTask(prompt: string, trust?: TrustLevel): Promise<{ taskId: string }>;
  getTask(id: string): Promise<TaskView>;
  /** Replays the task's events, then follows new ones. Resolves when the task ends or `signal` aborts. */
  streamTask(
    id: string,
    onEvent: (e: StreamEvent) => void,
    opts?: { lastEventId?: number; signal?: AbortSignal },
  ): Promise<void>;
  approve(id: string, body: ApproveBody): Promise<void>;
  answer(id: string, answer: string): Promise<void>;
  cancel(id: string): Promise<void>;
  extend(id: string, body?: ExtendBody): Promise<void>;
  home(): Promise<HomeData>;
}
