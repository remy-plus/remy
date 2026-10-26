// The chat screen: Ink components that render the controller's state. No JSX, because
// `pnpm remy` runs this file straight from TypeScript source with type stripping.
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
import type { Chat, ChatState, Item, PlanStep, ToolLine } from './chat.ts';
import { EMPTY_INPUT, editInput, type InputState, withText } from './input.ts';
import type { Theme } from './theme.ts';
import { TAGLINE, WORDMARK, WORDMARK_WIDTH } from './wordmark.ts';

export interface ChatAppProps {
  chat: Chat;
  theme: Theme;
  /** No animation: the thinking indicator and running tools show a still mark. */
  reducedMotion: boolean;
  /** A short line under the wordmark, such as the model in use. */
  subtitle?: string;
}

const STATE_WORD: Record<ToolLine['state'], string> = {
  waiting_approval: 'waiting for approval',
  running: 'running',
  ok: 'ok',
  failed: 'failed',
  denied: 'denied',
};

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

function Wordmark(p: { theme: Theme; columns: number; subtitle?: string }) {
  const { theme } = p;
  const wide = p.columns >= WORDMARK_WIDTH + 4;
  const rows = wide
    ? WORDMARK.map((line, i) =>
        h(Text, { key: i, bold: true, color: theme.ramp(i, WORDMARK.length) }, line),
      )
    : [h(Text, { key: 'r', bold: true }, 'REMY')];
  return h(
    Box,
    { flexDirection: 'column', marginTop: 1, marginBottom: 1, paddingLeft: theme.space.indent },
    ...rows,
    h(Text, { color: theme.color('muted') }, [TAGLINE, p.subtitle].filter(Boolean).join('  ')),
    h(Text, { color: theme.color('muted') }, 'Type a message. /help lists shortcuts and commands.'),
  );
}

function ToolRow(p: { line: ToolLine; theme: Theme; spinner: string }) {
  const { line, theme } = p;
  const sym = theme.symbols;
  const mark: Record<ToolLine['state'], [string, string | undefined]> = {
    ok: [sym.ok, theme.color('accent')],
    failed: [sym.failed, undefined],
    denied: [sym.denied, theme.color('muted')],
    waiting_approval: [sym.waiting, undefined],
    running: [p.spinner, theme.color('muted')],
  };
  const [glyph, color] = mark[line.state];
  return h(
    Text,
    { wrap: 'truncate-end' },
    h(Text, { color }, `${glyph} `),
    h(Text, { bold: true }, line.tool),
    h(Text, { color: theme.color('muted') }, ` ${line.args}  ${STATE_WORD[line.state]}`),
  );
}

function PlanList(p: { steps: PlanStep[]; theme: Theme }) {
  const { theme } = p;
  const glyph = {
    pending: theme.symbols.todo,
    doing: theme.symbols.doing,
    done: theme.symbols.done,
  };
  return h(
    Box,
    { flexDirection: 'column', marginBottom: 1 },
    h(Text, { color: theme.color('muted') }, 'Plan'),
    ...p.steps.map((s, i) =>
      h(
        Text,
        { key: i, color: s.status === 'pending' ? theme.color('muted') : undefined },
        h(
          Text,
          { color: s.status === 'done' ? theme.color('accent') : undefined },
          `${glyph[s.status]} `,
        ),
        h(Text, { bold: s.status === 'doing' }, s.text),
      ),
    ),
  );
}

function ItemView(p: { item: Item; theme: Theme }) {
  const { item, theme } = p;
  const muted = theme.color('muted');
  const lead = (glyph: string, color?: string) =>
    h(Box, { width: 2, flexShrink: 0 }, h(Text, { color }, glyph));
  const row = (...kids: ReactNode[]) => h(Box, { marginBottom: 1 }, ...kids);
  switch (item.kind) {
    case 'user':
      return row(lead(theme.symbols.prompt, muted), h(Text, { bold: true }, item.text));
    case 'reply':
      return row(lead(' '), h(Text, null, item.text));
    case 'question':
      return row(lead(theme.symbols.waiting, muted), h(Text, null, item.text));
    case 'error':
      return row(lead(theme.symbols.failed), h(Text, { bold: true }, item.text));
    case 'note':
      return row(lead(' '), h(Text, { color: muted }, item.text));
    case 'tools':
      return h(
        Box,
        { flexDirection: 'column', marginBottom: 1, paddingLeft: 2 },
        ...item.lines.map((l) =>
          h(ToolRow, { key: l.callId, line: l, theme, spinner: theme.symbols.running }),
        ),
      );
  }
}

function Live(p: { state: ChatState; theme: Theme; reducedMotion: boolean }) {
  const { state, theme } = p;
  const muted = theme.color('muted');
  const spin = theme.symbols.spinner;
  const animate = !p.reducedMotion && state.phase === 'running';
  const frame = useFrame(animate, spin.length);
  const glyph = animate ? (spin[frame] as string) : theme.symbols.running;
  const kids: ReactNode[] = [];

  if (state.plan) kids.push(h(PlanList, { key: 'plan', steps: state.plan, theme }));
  if (state.tools.length)
    kids.push(
      h(
        Box,
        { key: 'tools', flexDirection: 'column', marginBottom: 1 },
        ...state.tools.map((l) => h(ToolRow, { key: l.callId, line: l, theme, spinner: glyph })),
      ),
    );
  if (state.streaming)
    kids.push(h(Box, { key: 'stream', marginBottom: 1 }, h(Text, null, state.streaming)));
  else if (state.thinking)
    kids.push(
      h(
        Text,
        { key: 'think', color: muted },
        `${glyph} ${state.step ? `Step ${state.step + 1}, thinking` : 'Thinking'}${animate ? '' : '...'}`,
      ),
    );
  if (state.retrying) kids.push(h(Text, { key: 'retry', color: muted }, state.retrying));
  if (state.approval) {
    const a = state.approval;
    kids.push(
      h(
        Box,
        { key: 'approval', flexDirection: 'column', marginBottom: 1 },
        h(Text, { bold: true }, 'Approval needed'),
        h(Text, null, a.preview),
        h(Text, { color: muted }, `Risk: ${a.risk}. Why: ${a.reason}`),
        h(Text, null, 'Approve? ', h(Text, { bold: true }, '[y/n]')),
      ),
    );
  }
  return h(Box, { flexDirection: 'column', paddingLeft: theme.space.indent }, ...kids);
}

function Prompt(p: { value: InputState; theme: Theme }) {
  const { text, cursor } = p.value;
  const { theme } = p;
  const before = text.slice(0, cursor);
  const at = text.slice(cursor, cursor + 1);
  const after = text.slice(cursor + 1);
  return h(
    Box,
    { paddingLeft: theme.space.indent },
    h(
      Box,
      { width: 2, flexShrink: 0 },
      h(Text, { color: theme.color('muted') }, theme.symbols.prompt),
    ),
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

export function ChatApp(props: ChatAppProps): ReactElement {
  const { chat, theme } = props;
  const state = useSyncExternalStore(chat.subscribe, chat.getState);
  const { exit } = useApp();
  const { columns } = useWindowSize();
  const [input, setInput] = useState<InputState>(EMPTY_INPUT);
  const recall = useRef(-1);

  const quit = useCallback(async () => {
    await chat.interrupt();
    // Let the last frame (the "Stopped" line) print before Ink shuts down.
    setTimeout(exit, 30);
  }, [chat, exit]);

  useEffect(() => {
    if (state.wantsExit) void quit();
  }, [state.wantsExit, quit]);

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
    if (state.phase === 'running') return;
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

  const header = [{ id: 'header' }, ...state.items.map((item, i) => ({ id: `i${i}`, item }))];
  const footer =
    state.phase === 'idle' || state.phase === 'waiting_user'
      ? 'Enter sends. Up recalls your last message. Esc clears.'
      : state.phase === 'running'
        ? `${state.step ? `Step ${state.step}. ` : ''}Ctrl+C stops the task; you can resume it later.`
        : 'y approves, n denies.';
  const cost = state.costUsd > 0 ? `  $${state.costUsd.toFixed(4)}` : '';

  return h(
    Box,
    { flexDirection: 'column', width: columns },
    h(Static<{ id: string; item?: Item }>, {
      items: header,
      // biome-ignore lint/correctness/noChildrenProp: createElement's types only accept Static's render function as a prop
      children: (entry) =>
        entry.item
          ? h(
              Box,
              { key: entry.id, paddingLeft: theme.space.indent, width: columns },
              h(ItemView, { item: entry.item, theme }),
            )
          : h(Wordmark, { key: entry.id, theme, columns, subtitle: props.subtitle }),
    }),
    h(Live, { state, theme, reducedMotion: props.reducedMotion }),
    state.phase === 'idle' || state.phase === 'waiting_user'
      ? h(Prompt, { value: input, theme })
      : null,
    h(
      Box,
      { paddingLeft: theme.space.indent },
      h(Text, { color: theme.color('muted') }, footer + cost),
    ),
  );
}

/** Opens the chat on the terminal and resolves when the user quits. */
export async function runChat(props: ChatAppProps): Promise<void> {
  const app = render(h(ChatApp, props), { exitOnCtrlC: false, patchConsole: false });
  await app.waitUntilExit();
}
