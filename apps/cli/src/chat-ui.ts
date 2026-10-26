// The chat screen: Ink components that render the controller's state. No JSX, because
// `pnpm remy` runs this file straight from TypeScript source with type stripping.
//
// Two regions, by construction:
//   - <Static> holds the transcript. Every item is printed once and then lives in the
//     terminal's own scrollback; Ink never redraws it.
//   - The live area holds only the active turn and is kept shorter than the screen. A
//     frame as tall as the terminal makes Ink clear and reprint everything, so the streaming
//     text is cut to the tail that fits.
import { Box, render, Static, Text, useApp, useInput, useStdout, useWindowSize } from 'ink';
import {
  createElement as h,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Chat, ChatState, Item } from './chat.ts';
import { EMPTY_INPUT, editInput, type InputState, withText } from './input.ts';
import { clip, type MdLine, renderMarkdown, type Span, strWidth } from './markdown.ts';
import {
  captureStray,
  createNotifier,
  gateSync,
  isFocusReport,
  type Notifier,
} from './terminal.ts';
import type { Theme } from './theme.ts';
import {
  APPROVAL_ROWS,
  type ApprovalView,
  approvalHeight,
  approvalRows,
  narrate,
  type PlanStep,
  streamBudget,
  type ToolLine,
  tailLines,
  toolBits,
  windowPlan,
} from './transcript.ts';
import { TranscriptView } from './transcript-view.ts';
import { TAGLINE, WORDMARK, WORDMARK_WIDTH } from './wordmark.ts';

export interface ChatAppProps {
  chat: Chat;
  theme: Theme;
  /** No animation: the thinking indicator and running tools show a still mark. */
  reducedMotion: boolean;
  /** The model in use, shown in the header and footer. */
  subtitle?: string;
  /** The folder files are made in, shown in the header. */
  workspace?: string;
  /** Print the one-line header: after /clear. */
  compactHeader?: boolean;
  /** Called after /clear: the host wipes the screen and mounts the app again. */
  onClear?: () => void;
  /** Rings when Remy waits and the window is not focused. */
  notifier?: Notifier;
  /** Overrides `APPROVAL_SETTLE_MS` (tests use 0). */
  approvalSettleMs?: number;
}

export interface RunOptions extends Omit<ChatAppProps, 'onClear' | 'compactHeader' | 'notifier'> {
  /** The terminal answered the synchronized-output query; without it frames are not wrapped. */
  sync?: boolean;
  /** Stray console and stderr writes while the screen is up: they go here, not onto the screen. */
  onStray?: (stream: 'stdout' | 'stderr', text: string) => void;
  env?: Record<string, string | undefined>;
}

/** The next frame index, ticking while `active`. Always 0 when motion is reduced. */
function useFrame(active: boolean, frames: number): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setFrame((f) => (f + 1) % frames), 80);
    return () => clearInterval(t);
  }, [active, frames]);
  return active ? frame : 0;
}

/** `value`, but a change shows at most once per `ms`; the first value shows at once. */
export function useSettled(value: string, ms: number): string {
  const [shown, setShown] = useState(value);
  const last = useRef(Date.now());
  useEffect(() => {
    if (value === shown) return;
    const wait = ms - (Date.now() - last.current);
    const apply = () => {
      last.current = Date.now();
      setShown(value);
    };
    if (wait <= 0) return apply();
    const t = setTimeout(apply, wait);
    return () => clearTimeout(t);
  }, [value, shown, ms]);
  return shown;
}

/** Text props for a muted look that still works with colors off. */
const mutedProps = (theme: Theme) => {
  const color = theme.color('muted');
  return color ? { color } : { dimColor: true };
};

function spanProps(sp: Span, theme: Theme) {
  return {
    ...(sp.bold && { bold: true }),
    ...(sp.italic && { italic: true }),
    ...(sp.dim && mutedProps(theme)),
    ...(sp.code && { color: theme.color('accent') }),
  };
}

function Rich(p: { lines: MdLine[]; theme: Theme; wrap?: 'wrap' | 'truncate-end' }) {
  return h(
    Box,
    { flexDirection: 'column' },
    ...p.lines.map((line, i) =>
      h(
        Text,
        { key: i, wrap: p.wrap ?? 'wrap' },
        ...(line.length
          ? line.map((sp, j) => h(Text, { key: j, ...spanProps(sp, p.theme) }, sp.text))
          : [' ']),
      ),
    ),
  );
}

/** A row with a two-column lead (glyph or blank) and a body, indented like everything else. */
function Row(p: { theme: Theme; lead?: ReactNode; marginTop?: number; children?: ReactNode }) {
  return h(
    Box,
    { paddingLeft: p.theme.space.indent, marginTop: p.marginTop ?? 0 },
    h(Box, { width: 2, flexShrink: 0 }, p.lead ?? null),
    h(Box, { flexDirection: 'column', flexGrow: 1, flexShrink: 1 }, p.children),
  );
}

/** How long a new approval card ignores y / n / e / v, so type-ahead cannot answer it. */
export const APPROVAL_SETTLE_MS = 500;

const home = process.env.HOME;
const shortPath = (p: string) => {
  const q = home && p.startsWith(home) ? `~${p.slice(home.length)}` : p;
  // Keep both ends of a long path: the start says where, the end says which.
  return q.length > 48 ? `${q.slice(0, 14)}…${q.slice(-33)}` : q;
};

function Header(p: {
  theme: Theme;
  columns: number;
  model?: string;
  workspace?: string;
  compact?: boolean;
}) {
  const { theme } = p;
  const muted = mutedProps(theme);
  const info = [p.model, p.workspace && shortPath(p.workspace)].filter(Boolean).join(' · ');
  if (p.compact || p.columns < WORDMARK_WIDTH + 4)
    return h(
      Box,
      { paddingLeft: theme.space.indent, marginTop: 1, marginBottom: 1 },
      h(
        Text,
        { wrap: 'truncate-end' },
        h(Text, { bold: true }, 'REMY'),
        h(Text, muted, `  ${info}`),
      ),
    );
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1, marginBottom: 1, paddingLeft: theme.space.indent },
    ...WORDMARK.map((line, i) =>
      h(Text, { key: i, bold: true, color: theme.ramp(i, WORDMARK.length) }, line),
    ),
    h(Text, muted, TAGLINE),
    h(Text, { ...muted, wrap: 'truncate-end' }, info),
  );
}

function ToolRow(p: { line: ToolLine; theme: Theme; spinner: string; now?: number }) {
  const { line, theme } = p;
  const sym = theme.symbols;
  const glyph: Record<ToolLine['state'], [string, string | undefined]> = {
    ok: [sym.ok, theme.color('accent')],
    failed: [sym.failed, undefined],
    denied: [sym.denied, theme.color('muted')],
    waiting_approval: [sym.waiting, undefined],
    running: [p.spinner, theme.color('muted')],
  };
  const [mark, color] = glyph[line.state];
  const bits = toolBits(line, p.now);
  return h(
    Box,
    { paddingLeft: theme.space.indent },
    h(Box, { width: 2, flexShrink: 0 }, h(Text, { color }, mark)),
    h(
      Text,
      { wrap: 'truncate-end' },
      h(Text, null, `${line.verb} `),
      h(Text, mutedProps(theme), line.target),
      bits.length ? h(Text, mutedProps(theme), `  ${bits.join(' · ')}`) : null,
    ),
  );
}

function PlanList(p: { steps: PlanStep[]; theme: Theme; max: number; title?: string }) {
  const { theme } = p;
  const { shown, hidden } = windowPlan(p.steps, p.max);
  const done = p.steps.filter((s) => s.status === 'done').length;
  const glyph = {
    pending: theme.symbols.todo,
    doing: theme.symbols.doing,
    done: theme.symbols.done,
  };
  return h(
    Box,
    { flexDirection: 'column', paddingLeft: theme.space.indent },
    h(Text, mutedProps(theme), `${p.title ?? 'Plan'} ${done}/${p.steps.length}`),
    ...shown.map((s, i) =>
      h(
        Text,
        { key: i, wrap: 'truncate-end', ...(s.status === 'pending' && mutedProps(theme)) },
        h(
          Text,
          { color: s.status === 'done' ? theme.color('accent') : undefined },
          `${glyph[s.status]} `,
        ),
        h(Text, { bold: s.status === 'doing' }, s.text),
      ),
    ),
    hidden ? h(Text, mutedProps(theme), `  ... ${hidden} more`) : null,
  );
}

function TranscriptItem(p: { item: Item; theme: Theme; columns: number }) {
  const { item, theme } = p;
  const muted = mutedProps(theme);
  const body = Math.max(12, p.columns - theme.space.indent - 3);
  const md = (text: string) => h(Rich, { lines: renderMarkdown(text, body), theme });
  switch (item.kind) {
    case 'user':
      return h(
        Row,
        { theme, marginTop: 1, lead: h(Text, muted, theme.symbols.prompt) },
        h(Text, { bold: true }, item.text),
      );
    case 'reply':
    case 'text':
      return h(Row, { theme, marginTop: 1 }, md(item.text));
    case 'question':
      return h(
        Row,
        { theme, marginTop: 1, lead: h(Text, muted, theme.symbols.waiting) },
        md(item.text),
      );
    case 'tool':
      return h(ToolRow, { line: item.line, theme, spinner: theme.symbols.running });
    case 'plan':
      return h(PlanList, { steps: item.steps, theme, max: 8 });
    case 'error':
      return h(
        Row,
        { theme, marginTop: 1, lead: h(Text, null, theme.symbols.failed) },
        h(Text, { bold: true }, item.text),
      );
    case 'note':
      return h(Row, { theme, marginTop: 1 }, h(Text, muted, item.text));
  }
}

function ApprovalCard(p: {
  view: ApprovalView;
  theme: Theme;
  columns: number;
  expanded: boolean;
  /** Rows the expanded card may take. */
  room: number;
  /** The user is typing a note for a denial. */
  noting: boolean;
}) {
  const { view, theme } = p;
  const inner = Math.max(10, p.columns - theme.space.indent * 2 - 4);
  const fit = (s: string) => clip(s, inner);
  const muted = mutedProps(theme);
  const colorOf = {
    add: theme.color('diffAdd'),
    del: theme.color('diffDel'),
    dim: undefined,
    plain: undefined,
  };
  const { shown, hidden } = approvalRows(view, p.expanded, p.room);
  const key = (k: string, label: string) => [h(Text, { key: k, bold: true }, k), ` ${label}`];
  return h(
    Box,
    { paddingLeft: theme.space.indent },
    h(
      Box,
      {
        flexDirection: 'column',
        borderStyle: 'round',
        borderColor: theme.color('muted'),
        paddingX: 1,
        flexGrow: 1,
      },
      h(Text, { bold: true, wrap: 'truncate-end' }, fit(view.title)),
      ...shown.map((r, i) =>
        h(
          Text,
          {
            key: i,
            wrap: 'truncate-end',
            color: colorOf[r.kind],
            ...(r.kind === 'dim' && muted),
          },
          fit(r.text),
        ),
      ),
      hidden
        ? h(
            Text,
            { wrap: 'truncate-end', ...muted },
            fit(
              `... ${hidden} more ${hidden === 1 ? 'row' : 'rows'}${p.expanded ? '' : ' (v shows all)'}`,
            ),
          )
        : null,
      h(Text, { wrap: 'truncate-end', ...muted }, fit(view.risk)),
      h(
        Text,
        { wrap: 'truncate-end', ...muted },
        fit(`Approval covers exactly this call (${view.shortHash}).`),
      ),
      p.noting
        ? h(
            Text,
            { wrap: 'truncate-end' },
            'Say why below. Enter sends it as a denial, Esc goes back.',
          )
        : h(
            Text,
            { wrap: 'truncate-end' },
            ...key('y', 'approve once   '),
            ...key('n', 'deny   '),
            ...key('e', 'deny and say why'),
            ...(view.more
              ? [h(Text, { key: 'v', ...muted }, '   '), ...key('v', p.expanded ? 'fewer' : 'more')]
              : []),
          ),
    ),
  );
}

const STATE_WORD: Record<ChatState['phase'], string> = {
  idle: 'ready',
  running: 'working',
  waiting_approval: 'needs approval',
  waiting_user: 'needs your answer',
};

/** Context-aware key hints for the footer. */
export function hintsFor(phase: ChatState['phase'], hasInput: boolean, noting = false): string {
  if (noting) return 'Enter send note · Esc back · Ctrl+C stop';
  switch (phase) {
    case 'running':
      return 'Enter queue · Ctrl+C stop';
    case 'waiting_approval':
      return 'y approve · n deny · e say why';
    case 'waiting_user':
      return 'Enter answer · Ctrl+C stop';
    default:
      return hasInput ? 'Enter send · Esc clear' : 'Enter send · ↑ recall · /help';
  }
}

/** `14% context`, only when the model's window is known. */
export function contextPart(s: Pick<ChatState, 'contextTokens' | 'contextWindow'>): string {
  if (!s.contextWindow || s.contextTokens <= 0) return '';
  return `${Math.min(100, Math.round((s.contextTokens / s.contextWindow) * 100))}% context`;
}

/** `$0.04 of $0.50`: this task's spend against its budget. */
export function costPart(s: Pick<ChatState, 'taskCostUsd' | 'budgetUsd'>): string {
  if (s.budgetUsd === undefined) return '';
  const x = s.taskCostUsd;
  const spent = x <= 0 ? '$0' : x < 0.01 ? '<$0.01' : `$${x.toFixed(2)}`;
  return `${spent} of $${s.budgetUsd.toFixed(2)}`;
}

function Footer(p: {
  state: ChatState;
  theme: Theme;
  model?: string;
  hasInput: boolean;
  noting: boolean;
}) {
  const { state } = p;
  const left = [p.model, contextPart(state), costPart(state), STATE_WORD[state.phase]]
    .filter(Boolean)
    .join(' · ');
  return h(
    Box,
    { paddingLeft: p.theme.space.indent },
    h(
      Text,
      { wrap: 'truncate-end', ...mutedProps(p.theme) },
      `${left}   ${hintsFor(state.phase, p.hasInput, p.noting)}`,
    ),
  );
}

function Prompt(p: { value: InputState; theme: Theme }) {
  const { text, cursor } = p.value;
  const { theme } = p;
  const before = text.slice(0, cursor);
  const at = text.slice(cursor, cursor + 1);
  const after = text.slice(cursor + 1);
  return h(
    Box,
    { paddingLeft: theme.space.indent, marginTop: 1 },
    h(Box, { width: 2, flexShrink: 0 }, h(Text, mutedProps(theme), theme.symbols.prompt)),
    h(
      Text,
      null,
      before,
      // The cursor is the one place the accent colour sits on the input.
      h(
        Text,
        { color: theme.color('accent'), inverse: theme.level === 'none' },
        at || theme.symbols.cursor,
      ),
      after,
    ),
  );
}

/** How many rows the prompt takes at this width. */
export const promptRows = (text: string, columns: number) =>
  1 + Math.floor(strWidth(text) / Math.max(1, columns - 5));

const MAX_TOOL_ROWS = 8;
const MAX_QUEUE_ROWS = 3;
const MAX_PLAN_ROWS = 5;

function Live(p: {
  state: ChatState;
  theme: Theme;
  reducedMotion: boolean;
  columns: number;
  rows: number;
  /** Rows taken below the live content: prompt and footer. */
  below: number;
  expanded: boolean;
  noting: boolean;
}) {
  const { state, theme, columns } = p;
  const muted = mutedProps(theme);
  const spin = theme.symbols.spinner;
  const busy = state.phase === 'running';
  const animate = !p.reducedMotion && busy;
  const frame = useFrame(animate, spin.length);
  const glyph = animate ? (spin[frame] as string) : theme.symbols.running;
  const tools = state.tools.slice(-MAX_TOOL_ROWS);
  const queued = state.queue.slice(-MAX_QUEUE_ROWS);
  const planRows = state.plan?.length
    ? 1 + Math.min(state.plan.length, MAX_PLAN_ROWS) + (state.plan.length > MAX_PLAN_ROWS ? 1 : 0)
    : 0;
  const approval = state.phase === 'waiting_approval' ? state.approvalView : undefined;
  const fixedBase =
    p.below + tools.length + queued.length + planRows + (busy ? 1 : 0) + (state.retrying ? 1 : 0);
  // An expanded card may use what the screen has left, minus the card's own frame.
  const cardRoom = Math.max(APPROVAL_ROWS, p.rows - 1 - fixedBase - 6);
  const fixed = fixedBase + (approval ? approvalHeight(approval, p.expanded, cardRoom) : 0);
  const room = streamBudget(p.rows, fixed);
  const tail = state.streaming
    ? tailLines(
        renderMarkdown(state.streaming, Math.max(12, columns - theme.space.indent - 3)),
        room,
      )
    : [];

  // One row, and it changes at most once a second so the live area does not flicker.
  const secs = state.turnStartedAt ? Math.floor((Date.now() - state.turnStartedAt) / 1000) : 0;
  const narration = useSettled(narrate({ ...state, secs: animate ? secs : undefined }), 1000);

  const kids: ReactNode[] = [];
  if (tail.length)
    kids.push(
      h(Row, { key: 'stream', theme }, h(Rich, { lines: tail, theme, wrap: 'truncate-end' })),
    );
  if (state.plan?.length)
    kids.push(h(PlanList, { key: 'plan', steps: state.plan, theme, max: MAX_PLAN_ROWS }));
  for (const l of tools)
    kids.push(h(ToolRow, { key: l.callId, line: l, theme, spinner: glyph, now: Date.now() }));
  if (approval)
    kids.push(
      h(ApprovalCard, {
        key: 'approval',
        view: approval,
        theme,
        columns,
        expanded: p.expanded,
        room: cardRoom,
        noting: p.noting,
      }),
    );
  if (state.retrying)
    kids.push(h(Text, { key: 'retry', wrap: 'truncate-end', ...muted }, `  ${state.retrying}`));
  for (const [i, q] of queued.entries())
    kids.push(
      h(
        Box,
        { key: `q${i}`, paddingLeft: theme.space.indent },
        h(Box, { width: 2, flexShrink: 0 }, h(Text, muted, theme.symbols.prompt)),
        h(Text, { wrap: 'truncate-end', ...muted }, `${q}  queued`),
      ),
    );
  if (busy) {
    kids.push(
      h(
        Box,
        { key: 'spin', paddingLeft: theme.space.indent },
        h(Text, { ...muted, wrap: 'truncate-end' }, `${glyph} ${narration}`),
      ),
    );
  }
  return h(Box, { flexDirection: 'column' }, ...kids);
}

export function ChatApp(props: ChatAppProps): ReactElement {
  const { chat, theme } = props;
  const state = useSyncExternalStore(chat.subscribe, chat.getState);
  const { exit } = useApp();
  const { columns, rows } = useWindowSize();
  const [input, setInput] = useState<InputState>(EMPTY_INPUT);
  const recall = useRef(-1);
  const seenClears = useRef(state.clears);
  const [expanded, setExpanded] = useState(false);
  const [noting, setNoting] = useState(false);
  const [viewing, setViewing] = useState(false);
  const { write } = useStdout();
  const approvalId = state.approval?.callId;

  // Each approval starts collapsed, with no note under way.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the trigger, not a value read
  useEffect(() => {
    setExpanded(false);
    setNoting(false);
  }, [approvalId]);

  const quit = useCallback(async () => {
    await chat.interrupt();
    // Let the last frame (the "Stopped" line) print before Ink shuts down.
    setTimeout(exit, 30);
  }, [chat, exit]);

  useEffect(() => {
    if (state.wantsExit) void quit();
  }, [state.wantsExit, quit]);

  useEffect(() => {
    if (state.clears === seenClears.current) return;
    seenClears.current = state.clears;
    props.onClear?.();
  }, [state.clears, props.onClear]);

  const { notifier } = props;
  useEffect(() => {
    if (state.phase === 'waiting_approval' || state.phase === 'waiting_user')
      notifier?.attention(state.phase);
  }, [state.phase, notifier]);

  // Keys typed just before a card appears must not answer it, so the card ignores
  // approval keys until it has been on screen for a moment.
  const cardSince = useRef(0);
  const card = state.phase === 'waiting_approval' ? state.approvalView : undefined;
  useEffect(() => {
    if (card) cardSince.current = Date.now();
  }, [card]);

  // The full view hides the live area, so it gives way when Remy needs an answer.
  useEffect(() => {
    if (state.phase === 'waiting_approval' || state.phase === 'waiting_user') setViewing(false);
  }, [state.phase]);

  useInput((ch, key) => {
    // The transcript view reads its own keys.
    if (viewing) return;
    // Focus reports are for the notifier, not the editor.
    if (isFocusReport(ch)) return;
    if (key.ctrl && ch === 'd') return void quit();
    if (key.ctrl && ch === 'o' && state.phase !== 'waiting_approval') return setViewing(true);
    if (key.ctrl && ch === 'c') {
      if (state.phase !== 'idle') return void chat.interrupt();
      if (input.text) return setInput(EMPTY_INPUT);
      return void quit();
    }
    if (state.phase === 'waiting_approval') {
      if (noting) {
        if (key.escape) {
          setNoting(false);
          return setInput(EMPTY_INPUT);
        }
        if (key.return) {
          // An empty note does nothing: `n` is the plain denial.
          const note = input.text.trim();
          if (!note) return;
          setNoting(false);
          setInput(EMPTY_INPUT);
          return void chat.approve(false, note);
        }
        return setInput((cur) => editInput(cur, ch, key));
      }
      // Single keys only, and never Enter: a pasted or stray character cannot approve.
      if (Date.now() - cardSince.current < (props.approvalSettleMs ?? APPROVAL_SETTLE_MS)) return;
      if (/^y$/i.test(ch)) void chat.approve(true);
      else if (/^n$/i.test(ch)) void chat.approve(false);
      else if (/^e$/i.test(ch)) {
        setInput(EMPTY_INPUT);
        setNoting(true);
      } else if (/^v$/i.test(ch)) setExpanded((x) => !x);
      return;
    }
    if (key.escape) {
      recall.current = -1;
      return setInput(EMPTY_INPUT);
    }
    if (key.return) {
      const text = input.text;
      recall.current = -1;
      setInput(EMPTY_INPUT);
      return void chat.submit(text);
    }
    if (key.upArrow || key.downArrow) {
      const past = chat.history();
      const next = Math.min(past.length - 1, Math.max(-1, recall.current + (key.upArrow ? 1 : -1)));
      recall.current = next;
      return setInput(next < 0 ? EMPTY_INPUT : withText(past[past.length - 1 - next] as string));
    }
    setInput((cur) => editInput(cur, ch, key));
  });

  const showPrompt = state.phase !== 'waiting_approval' || noting;
  // Prompt (with its blank line above) and the footer.
  const below = (showPrompt ? 1 + promptRows(input.text, columns) : 0) + 1;
  const entries = [{ id: 'header' } as { id: string; item?: Item }].concat(
    state.items.map((item, i) => ({ id: `i${i}`, item })),
  );

  return h(
    Box,
    { flexDirection: 'column', width: columns },
    h(Static<{ id: string; item?: Item }>, {
      items: entries,
      // biome-ignore lint/correctness/noChildrenProp: createElement's types only accept Static's render function as a prop
      children: (entry) =>
        entry.item
          ? h(TranscriptItem, { key: entry.id, item: entry.item, theme, columns })
          : h(Header, {
              key: entry.id,
              theme,
              columns,
              model: props.subtitle,
              workspace: props.workspace,
              compact: props.compactHeader,
            }),
    }),
    viewing
      ? h(TranscriptView, {
          items: state.items,
          columns,
          rows,
          theme,
          onClose: (dump) => {
            if (dump) write(dump);
            setViewing(false);
          },
        })
      : null,
    viewing
      ? null
      : h(Live, {
          state,
          theme,
          reducedMotion: props.reducedMotion,
          columns,
          rows,
          below,
          expanded,
          noting,
        }),
    showPrompt && !viewing ? h(Prompt, { value: input, theme }) : null,
    viewing
      ? null
      : h(Footer, {
          state,
          theme,
          model: props.subtitle,
          hasInput: input.text.length > 0,
          noting,
        }),
  );
}

const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';

/** Opens the chat on the terminal and resolves when the user quits. */
export async function runChat(props: RunOptions): Promise<void> {
  const { sync = false, onStray, env = process.env, ...appProps } = props;
  const stdout = gateSync(process.stdout, sync);
  const notifier = createNotifier(env, process.stdin, process.stdout);
  // Without --debug the writes are kept and shown on the real stderr once the screen is gone.
  const kept: string[] = [];
  const restoreStray = captureStray(
    onStray ?? ((stream, text) => void kept.push(stream === 'stderr' ? text : `${text}\n`)),
  );
  try {
    let compact = false;
    for (;;) {
      let restart = false;
      const app = render(
        h(ChatApp, {
          ...appProps,
          notifier,
          compactHeader: compact,
          onClear: () => {
            restart = true;
            // Unmount after this render finishes; the next mount prints the header again.
            setImmediate(() => app.unmount());
          },
        }),
        { stdout, exitOnCtrlC: false, patchConsole: false },
      );
      await app.waitUntilExit();
      if (!restart) return;
      process.stdout.write(CLEAR_SCREEN);
      compact = true;
    }
  } finally {
    notifier.stop();
    restoreStray();
    if (kept.length) process.stderr.write(kept.join(''));
  }
}
