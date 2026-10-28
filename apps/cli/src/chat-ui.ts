// The chat screen: Ink components that render the controller's state. No JSX, because
// `pnpm remy` runs this file straight from TypeScript source with type stripping.
//
// Two regions, by construction:
//   - <Static> holds the transcript. Every item is printed once and then lives in the
//     terminal's own scrollback; Ink never redraws it.
//   - The live area holds only the active turn and is kept shorter than the screen. A
//     frame as tall as the terminal makes Ink clear and reprint everything, so the streaming
//     text is cut to the tail that fits.
import { Box, render, Static, Text, useStdout, useWindowSize } from 'ink';
import { createElement as h, type ReactElement, type ReactNode, useSyncExternalStore } from 'react';
import { ApprovalCard } from './approval-ui.ts';
import type { Chat, ChatState, Item } from './chat.ts';
import { APPROVAL_SETTLE_MS, useChatKeys } from './chat-keys.ts';
import { EXAMPLES } from './examples.ts';
import { Hints } from './hints.ts';
import type { InputMode, InputState } from './input.ts';
import { useFrame, useSettled } from './live-hooks.ts';
import { type MdLine, renderMarkdown, strWidth, wrapPlain } from './markdown.ts';
import { Overlay } from './overlay-ui.ts';
import { Menu, menuRows } from './picker.ts';
import { SessionPicker } from './session-picker.ts';
import { spanProps } from './span-style.ts';
import { captureStray, createNotifier, gateSync, type Notifier } from './terminal.ts';
import type { Theme } from './theme.ts';
import {
  APPROVAL_ROWS,
  approvalHeight,
  narrate,
  type PlanStep,
  reasoningTitle,
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
  /** `single` is the old one-line editor (REMY_INPUT=single). Default `multi`. */
  inputMode?: InputMode;
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

/** Text props for a muted look that still works with colors off. */
const mutedProps = (theme: Theme) => theme.props('muted');

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
    h(Box, { width: p.theme.space.lead, flexShrink: 0 }, p.lead ?? null),
    h(Box, { flexDirection: 'column', flexGrow: 1, flexShrink: 1 }, p.children),
  );
}

export { APPROVAL_SETTLE_MS, EXAMPLES, useSettled };

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
  const { turn, indent, lead } = theme.space;
  const muted = mutedProps(theme);
  const info = [p.model, p.workspace && shortPath(p.workspace)]
    .filter(Boolean)
    .join(` ${theme.symbols.dot} `);
  if (p.compact || p.columns < WORDMARK_WIDTH + 4)
    return h(
      Box,
      { paddingLeft: indent, marginTop: turn },
      h(
        Text,
        { wrap: 'truncate-end' },
        h(Text, { bold: true }, 'REMY'),
        h(Text, muted, `  ${info}`),
      ),
    );
  return h(
    Box,
    { flexDirection: 'column', marginTop: turn, paddingLeft: indent },
    ...WORDMARK.map((line, i) =>
      h(Text, { key: i, bold: true, color: theme.ramp(i, WORDMARK.length) }, line),
    ),
    h(
      Box,
      { marginTop: turn, flexDirection: 'column' },
      h(Text, null, TAGLINE),
      h(Text, { ...muted, wrap: 'truncate-end' }, info),
    ),
    // Only once a model is connected: before that the login panel is the one thing to do.
    p.model
      ? h(
          Box,
          { flexDirection: 'column', marginTop: turn },
          h(Text, muted, 'Ask in your own words. For example'),
          ...EXAMPLES.map((e) =>
            h(
              Box,
              { key: e },
              h(Box, { width: lead, flexShrink: 0 }, h(Text, muted, theme.symbols.prompt)),
              h(Text, { wrap: 'truncate-end' }, e),
            ),
          ),
        )
      : null,
  );
}

/** Widest a tool row runs, so a right-aligned time stays near its row on a wide terminal. */
const MEASURE = 100;

function ToolRow(p: {
  line: ToolLine;
  theme: Theme;
  spinner: string;
  columns: number;
  now?: number;
  /** First row of a run of tools: one blank row above it. */
  first?: boolean;
}) {
  const { line, theme } = p;
  const { indent, lead, verb, column, turn } = theme.space;
  const sym = theme.symbols;
  const failed = theme.color('error');
  const glyph: Record<ToolLine['state'], [string, string | undefined]> = {
    ok: [sym.ok, theme.color('accent')],
    failed: [sym.failed, failed],
    denied: [sym.denied, theme.color('muted')],
    waiting_approval: [sym.waiting, undefined],
    running: [p.spinner, theme.color('muted')],
  };
  const [mark, color] = glyph[line.state];
  const bits = toolBits(line, p.now);
  // The time is the last bit once it is known; it sits at the right edge, the rest trails the target.
  const timed = line.ms !== undefined || (line.state === 'running' && bits.length > 0);
  const right = timed ? bits.at(-1) : undefined;
  const near = timed ? bits.slice(0, -1) : bits;
  const rest = near.length ? `  ${near.join(` ${sym.dot} `)}` : '';
  const strike = line.state === 'denied' ? { strikethrough: true } : {};
  return h(
    Box,
    {
      paddingLeft: indent,
      paddingRight: indent,
      marginTop: p.first ? turn : 0,
      width: Math.min(p.columns, MEASURE),
    },
    h(Box, { width: lead, flexShrink: 0 }, h(Text, { color }, mark)),
    h(
      Box,
      { flexGrow: 1, flexShrink: 1 },
      h(
        Text,
        { wrap: 'truncate-end' },
        h(Text, strike, line.verb.padEnd(verb)),
        h(Text, { ...mutedProps(theme), ...strike }, line.target),
        rest
          ? h(Text, line.state === 'failed' && failed ? { color: failed } : mutedProps(theme), rest)
          : null,
      ),
    ),
    right ? h(Box, { flexShrink: 0, marginLeft: column }, h(Text, mutedProps(theme), right)) : null,
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
    { flexDirection: 'column', paddingLeft: theme.space.indent, marginTop: theme.space.turn },
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

/** A long message of yours is cut to this many lines in the scrollback; Ctrl+O has the rest. */
const USER_LINES = 4;

function TranscriptItem(p: { item: Item; prev?: Item; theme: Theme; columns: number }) {
  const { item, theme } = p;
  const turn = theme.space.turn;
  const muted = mutedProps(theme);
  const body = Math.max(12, p.columns - theme.space.indent - theme.space.lead - 1);
  const md = (text: string) => h(Rich, { lines: renderMarkdown(text, body), theme });
  const userLines = item.kind === 'user' ? item.text.split('\n') : [];
  const shown = userLines.length > USER_LINES + 2 ? userLines.slice(0, USER_LINES) : userLines;
  const more = userLines.length - shown.length;
  switch (item.kind) {
    case 'user':
      return h(
        Row,
        { theme, marginTop: turn, lead: h(Text, muted, theme.symbols.prompt) },
        h(
          Box,
          { flexDirection: 'column' },
          h(Text, null, shown.flatMap((l) => wrapPlain(l, body)).join('\n')),
          more ? h(Text, muted, `... ${more} more lines (Ctrl+O shows all)`) : null,
        ),
      );
    case 'reply':
    case 'text':
      return h(Row, { theme, marginTop: turn }, md(item.text));
    case 'question':
      return h(
        Row,
        { theme, marginTop: turn, lead: h(Text, muted, theme.symbols.waiting) },
        md(item.text),
      );
    case 'tool':
      return h(ToolRow, {
        line: item.line,
        theme,
        spinner: theme.symbols.running,
        columns: p.columns,
        first: p.prev?.kind !== 'tool',
      });
    case 'plan':
      return h(PlanList, { steps: item.steps, theme, max: 8 });
    case 'error':
      return h(
        Row,
        {
          theme,
          marginTop: turn,
          lead: h(Text, { color: theme.color('error') }, theme.symbols.failed),
        },
        h(Text, { color: theme.color('error') }, item.text),
      );
    case 'note':
      return h(Row, { theme, marginTop: turn }, h(Text, muted, item.text));
  }
}

const STATE_WORD: Record<ChatState['phase'], string> = {
  idle: 'ready',
  running: 'working',
  waiting_approval: 'needs approval',
  waiting_user: 'needs your answer',
};

/** What the footer offers right now. */
export interface HintContext {
  phase: ChatState['phase'];
  hasInput: boolean;
  noting?: boolean;
  /** An autocomplete list is open under the prompt. */
  menu?: 'slash' | 'file';
  /** A panel (login, models, palette) is open. */
  overlay?: boolean;
  /** No model is connected yet. */
  unconnected?: boolean;
  /** Nothing has been said yet. */
  fresh?: boolean;
}

/** Context-aware key hints for the footer. */
export function hintsFor(
  phase: ChatState['phase'] | HintContext,
  hasInput = false,
  noting = false,
): string {
  const c: HintContext = typeof phase === 'string' ? { phase, hasInput, noting } : phase;
  if (c.overlay) return '';
  if (c.noting) return 'Enter send note · Esc back · Ctrl+C stop';
  if (c.menu === 'slash') return '↑↓ choose · Tab complete · Enter run';
  if (c.menu === 'file') return '↑↓ choose · Tab attach';
  switch (c.phase) {
    case 'running':
      return 'Enter queue · Ctrl+C stop';
    case 'waiting_approval':
      return 'y approve · n deny · e say why';
    case 'waiting_user':
      return 'Enter answer · Ctrl+C stop';
    default:
      if (c.unconnected) return '/login connect a model · Ctrl+P menu';
      if (c.hasInput) return 'Enter send · Esc clear';
      return c.fresh
        ? 'Enter send · / commands · @ file · Ctrl+P menu'
        : 'Enter send · / commands · Ctrl+P menu';
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

/** Columns between the footer's figures and its key hints. */
const FOOTER_GAP = 3;

function Footer(p: {
  state: ChatState;
  theme: Theme;
  columns: number;
  model?: string;
  hasInput: boolean;
  noting: boolean;
  menu?: 'slash' | 'file';
}) {
  const { state, theme } = p;
  const unconnected = !p.model;
  const word = unconnected ? '' : STATE_WORD[state.phase];
  const hint = hintsFor({
    phase: state.phase,
    hasInput: p.hasInput,
    noting: p.noting,
    menu: p.menu,
    overlay: Boolean(state.overlay),
    unconnected,
    fresh: !state.items.some((i) => i.kind === 'user'),
  });
  // On a narrow terminal the figures go first and the key hints last: hints are what unblocks.
  const room = p.columns - theme.space.indent * 2;
  const join = (parts: string[]) => parts.filter(Boolean).join(` ${theme.symbols.dot} `);
  const name = p.model ?? 'not connected';
  const tries = [[contextPart(state), costPart(state)], [costPart(state)], []].map((figures) =>
    join(figures),
  );
  const fits = (figures: string) =>
    strWidth(join([name, figures, word])) + (hint ? FOOTER_GAP + strWidth(hint) : 0) <= room;
  const figures = tries.find(fits) ?? '';
  const attention = state.phase === 'waiting_approval' || state.phase === 'waiting_user';
  return h(
    Box,
    { paddingLeft: theme.space.indent },
    h(
      Box,
      { flexShrink: 0 },
      h(
        Text,
        null,
        h(Text, unconnected ? mutedProps(theme) : null, name),
        figures ? h(Text, mutedProps(theme), ` ${theme.symbols.dot} ${figures}`) : null,
        word
          ? h(Text, attention ? null : mutedProps(theme), ` ${theme.symbols.dot} ${word}`)
          : null,
      ),
    ),
    hint ? h(Box, { marginLeft: FOOTER_GAP, flexShrink: 1 }, h(Hints, { hint, theme })) : null,
  );
}

/** Lines of a long input shown at once, around the cursor. */
export const MAX_PROMPT_LINES = 6;

/** The lines of the input to show: all of them, or a window that holds the cursor line. */
export function promptWindow(text: string, cursor: number) {
  const lines = text.split('\n');
  const at = text.slice(0, cursor).split('\n').length - 1;
  const start = Math.max(0, Math.min(at - MAX_PROMPT_LINES + 1, lines.length - MAX_PROMPT_LINES));
  return { lines: lines.slice(start, start + MAX_PROMPT_LINES), from: start, at };
}

function Prompt(p: { value: InputState; theme: Theme; columns: number }) {
  const { text, cursor } = p.value;
  const { theme } = p;
  const { lines, from, at } = promptWindow(text, cursor);
  const col = cursor - (text.split('\n').slice(0, at).join('\n').length + (at ? 1 : 0));
  return h(
    Box,
    { flexDirection: 'column' },
    h(
      Box,
      { paddingLeft: theme.space.indent },
      h(
        Text,
        theme.props('faint'),
        theme.symbols.rule.repeat(Math.max(0, p.columns - theme.space.indent * 2)),
      ),
    ),
    ...lines.map((line, i) => {
      const here = from + i === at;
      const before = here ? line.slice(0, col) : line;
      const sym = h(
        Box,
        { width: theme.space.lead, flexShrink: 0 },
        h(Text, mutedProps(theme), from + i === 0 ? theme.symbols.prompt : ' '),
      );
      return h(
        Box,
        { key: i, paddingLeft: theme.space.indent },
        sym,
        here
          ? h(
              Text,
              null,
              before,
              // The cursor is the one place the accent colour sits on the input.
              h(
                Text,
                { color: theme.color('accent'), inverse: theme.level === 'none' },
                line.slice(col, col + 1) || theme.symbols.cursor,
              ),
              line.slice(col + 1),
            )
          : h(Text, null, line || ' '),
      );
    }),
  );
}

/** How many rows the prompt takes at this width: each shown line, wrapped. */
export const promptRows = (text: string, columns: number, cursor = text.length) =>
  promptWindow(text, cursor).lines.reduce(
    (n, l) => n + 1 + Math.floor(strWidth(l) / Math.max(1, columns - 5)),
    0,
  );

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
  const detail =
    busy && state.showThinking && state.reasoning && !state.streaming
      ? tailLines(state.reasoning.split('\n').filter(Boolean), 3)
      : [];
  // A run of tools that follows earlier tool rows (already in the transcript) shares their block.
  const continuesTools = state.items.at(-1)?.kind === 'tool' && !state.streaming;
  const fixedBase =
    p.below +
    tools.length +
    queued.length +
    planRows +
    detail.length +
    (busy ? 1 + theme.space.turn : 0) +
    (tools.length && !continuesTools ? theme.space.turn : 0) +
    (state.plan?.length ? theme.space.turn : 0) +
    (state.retrying ? 1 : 0);
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
  const narration = useSettled(
    narrate({
      ...state,
      secs: animate ? secs : undefined,
      thinkingTitle: reasoningTitle(state.reasoning),
    }),
    1000,
  );

  const kids: ReactNode[] = [];
  if (tail.length)
    kids.push(
      h(Row, { key: 'stream', theme }, h(Rich, { lines: tail, theme, wrap: 'truncate-end' })),
    );
  if (state.plan?.length)
    kids.push(h(PlanList, { key: 'plan', steps: state.plan, theme, max: MAX_PLAN_ROWS }));
  for (const [i, l] of tools.entries())
    kids.push(
      h(ToolRow, {
        key: l.callId,
        line: l,
        theme,
        spinner: glyph,
        columns,
        now: Date.now(),
        first: i === 0 && !continuesTools,
      }),
    );
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
        h(Box, { width: theme.space.lead, flexShrink: 0 }, h(Text, muted, theme.symbols.prompt)),
        h(Text, { wrap: 'truncate-end', ...muted }, `${q}  queued`),
      ),
    );
  if (busy) {
    kids.push(
      h(
        Box,
        { key: 'spin', paddingLeft: theme.space.indent, marginTop: theme.space.turn },
        h(Text, { ...muted, wrap: 'truncate-end' }, `${glyph} ${narration}`),
      ),
    );
  }
  for (const [i, l] of detail.entries())
    kids.push(
      h(
        Box,
        { key: `r${i}`, paddingLeft: theme.space.indent + 2 },
        h(Text, { ...muted, wrap: 'truncate-end' }, l.replace(/\*\*/g, '')),
      ),
    );
  return h(Box, { flexDirection: 'column' }, ...kids);
}

export function ChatApp(props: ChatAppProps): ReactElement {
  const { chat, theme } = props;
  const state = useSyncExternalStore(chat.subscribe, chat.getState);
  const { columns, rows } = useWindowSize();
  const { write } = useStdout();
  const mode = props.inputMode ?? 'multi';
  const k = useChatKeys({ ...props, state, mode });
  const { input, expanded, noting, viewing, setViewing, menu, menuItems, at, slashQuery, atQuery } =
    k;

  const showPrompt = state.phase !== 'waiting_approval' || noting;
  // Prompt (with its blank line above) and the footer.
  const below =
    (showPrompt && !state.overlay ? 1 + promptRows(input.text, columns, input.cursor) : 0) +
    1 +
    (showPrompt && !state.overlay ? menuRows(menuItems.length) : 0);
  const entries = [{ id: 'header' } as { id: string; item?: Item }].concat(
    state.items.map((item, i) => ({ id: `i${i}`, item })),
  );

  return h(
    Box,
    // One column short of the edge: a line that fills the last column makes many terminals
    // wrap on their own, leaving a stray character alone on the next row.
    { flexDirection: 'column', width: Math.max(20, columns - 1) },
    h(Static<{ id: string; item?: Item }>, {
      items: entries,
      // biome-ignore lint/correctness/noChildrenProp: createElement's types only accept Static's render function as a prop
      children: (entry, n) =>
        entry.item
          ? h(TranscriptItem, {
              key: entry.id,
              item: entry.item,
              prev: entries[n - 1]?.item,
              theme,
              columns,
            })
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
    state.picker
      ? h(SessionPicker, {
          rows: state.picker,
          theme,
          onPick: (id) => void chat.resume(id),
          onCancel: () => chat.closePicker(),
        })
      : null,
    state.overlay ? h(Overlay, { chat, state, theme, onTranscript: () => setViewing(true) }) : null,
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
    showPrompt && !viewing && !state.picker && !state.overlay
      ? h(Prompt, { value: input, theme, columns })
      : null,
    menu && !viewing && !state.picker && !state.overlay
      ? h(Menu, {
          items: menuItems,
          at,
          theme,
          indent: theme.space.indent + theme.space.lead,
          query: slashQuery ?? atQuery ?? '',
        })
      : null,
    viewing
      ? null
      : h(Footer, {
          state,
          theme,
          columns,
          model: state.model ?? props.subtitle,
          hasInput: input.text.length > 0,
          noting,
          menu,
        }),
  );
}

const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H';

/** Opens the chat on the terminal and resolves when the user quits. */
export async function runChat(props: RunOptions): Promise<void> {
  const { sync = false, onStray, env = process.env, ...appProps } = props;
  appProps.inputMode ??= env.REMY_INPUT === 'single' ? 'single' : 'multi';
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
