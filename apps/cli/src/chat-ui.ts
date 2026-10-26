// The chat screen: Ink components that render the controller's state. No JSX, because
// `pnpm remy` runs this file straight from TypeScript source with type stripping.
//
// Two regions, by construction:
//   - <Static> holds the transcript. Every item is printed once and then lives in the
//     terminal's own scrollback; Ink never redraws it.
//   - The live area holds only the active turn and is kept shorter than the screen. A
//     frame as tall as the terminal makes Ink clear and reprint everything, so the streaming
//     text is cut to the tail that fits.
import { Box, render, Static, Text, useApp, useInput, useWindowSize } from 'ink';
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
import { fmtCost, fmtMs, fmtTokens } from './format.ts';
import { EMPTY_INPUT, editInput, type InputState, withText } from './input.ts';
import { clip, type MdLine, renderMarkdown, type Span, strWidth } from './markdown.ts';
import type { Theme } from './theme.ts';
import {
  type ApprovalView,
  approvalHeight,
  type PlanStep,
  streamBudget,
  type ToolLine,
  tailLines,
  windowPlan,
} from './transcript.ts';
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
  const live =
    line.state === 'running' && line.startedAt && p.now ? p.now - line.startedAt : undefined;
  const bits = [
    line.count > 1 ? `×${line.count}` : '',
    line.state === 'waiting_approval' ? 'waiting for approval' : '',
    line.reason ?? '',
    line.ms !== undefined ? fmtMs(line.ms) : live !== undefined && live >= 1000 ? fmtMs(live) : '',
  ].filter(Boolean);
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

function ApprovalCard(p: { view: ApprovalView; theme: Theme; columns: number }) {
  const { view, theme } = p;
  const inner = Math.max(10, p.columns - theme.space.indent * 2 - 4);
  const fit = (s: string) => clip(s, inner);
  const colorOf = { add: theme.color('accent'), del: undefined, dim: undefined, plain: undefined };
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
      ...view.rows.map((r, i) =>
        h(
          Text,
          {
            key: i,
            wrap: 'truncate-end',
            color: colorOf[r.kind],
            ...(r.kind === 'dim' && mutedProps(theme)),
          },
          fit(r.text),
        ),
      ),
      h(Text, { wrap: 'truncate-end', ...mutedProps(theme) }, fit(view.risk)),
      h(
        Text,
        null,
        h(Text, { bold: true }, 'y'),
        ' approve   ',
        h(Text, { bold: true }, 'n'),
        ' deny',
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
export function hintsFor(phase: ChatState['phase'], hasInput: boolean): string {
  switch (phase) {
    case 'running':
      return 'Enter queue · Ctrl+C stop';
    case 'waiting_approval':
      return 'y approve · n deny · Ctrl+C stop';
    case 'waiting_user':
      return 'Enter answer · Ctrl+C stop';
    default:
      return hasInput ? 'Enter send · Esc clear' : 'Enter send · ↑ recall · /help';
  }
}

function Footer(p: { state: ChatState; theme: Theme; model?: string; hasInput: boolean }) {
  const { state } = p;
  const left = [
    p.model,
    state.tokens ? `${fmtTokens(state.tokens)} tokens` : '',
    state.costUsd > 0 ? fmtCost(state.costUsd) : '',
    STATE_WORD[state.phase],
  ]
    .filter(Boolean)
    .join(' · ');
  return h(
    Box,
    { paddingLeft: p.theme.space.indent },
    h(
      Text,
      { wrap: 'truncate-end', ...mutedProps(p.theme) },
      `${left}   ${hintsFor(state.phase, p.hasInput)}`,
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
  const fixed =
    p.below +
    tools.length +
    queued.length +
    planRows +
    (approval ? approvalHeight(approval) : 0) +
    (busy ? 1 : 0) +
    (state.retrying ? 1 : 0);
  const room = streamBudget(p.rows, fixed);
  const tail = state.streaming
    ? tailLines(
        renderMarkdown(state.streaming, Math.max(12, columns - theme.space.indent - 3)),
        room,
      )
    : [];

  const kids: ReactNode[] = [];
  if (tail.length)
    kids.push(
      h(Row, { key: 'stream', theme }, h(Rich, { lines: tail, theme, wrap: 'truncate-end' })),
    );
  if (state.plan?.length)
    kids.push(h(PlanList, { key: 'plan', steps: state.plan, theme, max: MAX_PLAN_ROWS }));
  for (const l of tools)
    kids.push(h(ToolRow, { key: l.callId, line: l, theme, spinner: glyph, now: Date.now() }));
  if (approval) kids.push(h(ApprovalCard, { key: 'approval', view: approval, theme, columns }));
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
    const secs = state.turnStartedAt ? Math.floor((Date.now() - state.turnStartedAt) / 1000) : 0;
    const label = state.streaming
      ? 'Writing'
      : state.tools.some((t) => t.state === 'running')
        ? 'Working'
        : state.step
          ? 'Thinking'
          : 'Thinking';
    const text = animate
      ? `${label}${state.step ? ` · step ${state.step + 1}` : ''} · ${secs}s`
      : `${label}...`;
    kids.push(
      h(
        Box,
        { key: 'spin', paddingLeft: theme.space.indent },
        h(Text, { ...muted, wrap: 'truncate-end' }, `${glyph} ${text}`),
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

  useInput((ch, key) => {
    if (key.ctrl && ch === 'd') return void quit();
    if (key.ctrl && ch === 'c') {
      if (state.phase !== 'idle') return void chat.interrupt();
      if (input.text) return setInput(EMPTY_INPUT);
      return void quit();
    }
    if (state.phase === 'waiting_approval') {
      if (/^y$/i.test(ch)) void chat.approve(true);
      else if (/^n$/i.test(ch)) void chat.approve(false);
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

  const showPrompt = state.phase !== 'waiting_approval';
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
    h(Live, { state, theme, reducedMotion: props.reducedMotion, columns, rows, below }),
    showPrompt ? h(Prompt, { value: input, theme }) : null,
    h(Footer, { state, theme, model: props.subtitle, hasInput: input.text.length > 0 }),
  );
}

const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';

/** Opens the chat on the terminal and resolves when the user quits. */
export async function runChat(
  props: Omit<ChatAppProps, 'onClear' | 'compactHeader'>,
): Promise<void> {
  let compact = false;
  for (;;) {
    let restart = false;
    const app = render(
      h(ChatApp, {
        ...props,
        compactHeader: compact,
        onClear: () => {
          restart = true;
          // Unmount after this render finishes; the next mount prints the header again.
          setImmediate(() => app.unmount());
        },
      }),
      { exitOnCtrlC: false, patchConsole: false },
    );
    await app.waitUntilExit();
    if (!restart) return;
    process.stdout.write(CLEAR_SCREEN);
    compact = true;
  }
}
