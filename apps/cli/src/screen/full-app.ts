// The full-screen chat: a scrolling session above, the prompt (or an approval card, or a
// panel) in a bottom slot, one status row under the prompt. No header, no footer bar.
// The controller and the key handling are the classic screen's; only the view differs.
import { Box, Text, useWindowSize } from 'ink';
import {
  createElement as h,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { ApprovalCard } from '../approval-ui.ts';
import { useChatKeys } from '../chat-keys.ts';
import type { ChatAppProps } from '../chat-ui.ts';
import { EXAMPLES } from '../examples.ts';
import { useFrame, useSettled } from '../live-hooks.ts';
import { Overlay } from '../overlay-ui.ts';
import { Menu, menuRows } from '../picker.ts';
import { SessionPicker } from '../session-picker.ts';
import { APPROVAL_ROWS, approvalHeight, narrate, reasoningTitle } from '../transcript.ts';
import { TranscriptView } from '../transcript-view.ts';
import { buildRows, createRowCache, type LiveInput } from './compose.ts';
import { introRows } from './intro.ts';
import { computeLayout } from './layout.ts';
import { PromptBox, promptBoxRows } from './prompt-box.ts';
import {
  halfDown,
  halfUp,
  pageDown,
  pageUp,
  SCROLL_START,
  type Scroll,
  toBottom,
  topOf,
  toTop,
} from './scroll.ts';
import { statusLine } from './status.ts';
import { Viewport } from './viewport.ts';

/** Rows reserved for a login, model or session panel in the bottom slot. */
const PANEL_ROWS = 14;

function StatusRow(p: {
  theme: ChatAppProps['theme'];
  width: number;
  working?: { spinner: string; narration: string };
  workspace?: string;
  contextPct?: number;
  costUsd?: number;
}): ReactElement {
  const { theme } = p;
  const muted = theme.props('muted');
  const s = statusLine({ ...p, width: p.width - 1 });
  const right = s.right.endsWith('ctrl+p commands')
    ? s.right.slice(0, -'ctrl+p commands'.length)
    : s.right;
  return h(
    Box,
    { width: p.width, paddingLeft: 1, flexShrink: 0 },
    h(
      Box,
      { flexGrow: 1, flexShrink: 1 },
      h(Text, { wrap: 'truncate-end', ...muted }, s.left),
      s.hint ? h(Text, null, h(Text, muted, ' · '), 'esc', h(Text, muted, ' interrupt')) : null,
    ),
    s.right
      ? h(
          Box,
          { flexShrink: 0 },
          right ? h(Text, muted, right) : null,
          s.right.endsWith('ctrl+p commands')
            ? h(Text, null, 'ctrl+p', h(Text, muted, ' commands'))
            : null,
        )
      : null,
  );
}

export function FullApp(props: ChatAppProps): ReactElement {
  const { chat, theme } = props;
  const state = useSyncExternalStore(chat.subscribe, chat.getState);
  const { columns, rows } = useWindowSize();
  const layout = computeLayout(columns, rows, { sidebar: false });
  const width = layout.contentWidth;
  const cache = useRef(createRowCache());
  const [scroll, setScroll] = useState<Scroll>(SCROLL_START);
  const geometry = useRef({ total: 0, height: 1 });

  const onKey = useCallback(
    (
      ch: string,
      key: {
        pageUp?: boolean;
        pageDown?: boolean;
        home?: boolean;
        end?: boolean;
        ctrl?: boolean;
        escape?: boolean;
      },
      input: { text: string },
    ) => {
      const { total, height } = geometry.current;
      if (key.pageUp) return (setScroll((s) => pageUp(s, total, height)), true);
      if (key.pageDown) return (setScroll((s) => pageDown(s, total, height)), true);
      if (!input.text && key.ctrl && ch === 'u')
        return (setScroll((s) => halfUp(s, total, height)), true);
      if (!input.text && key.ctrl && ch === 'd')
        return (setScroll((s) => halfDown(s, total, height)), true);
      if (!input.text && key.home) return (setScroll(toTop(total, height)), true);
      if (!input.text && key.end) return (setScroll(toBottom()), true);
      if (key.escape && chat.getState().phase === 'running') return (void chat.interrupt(), true);
      return false;
    },
    [chat],
  );
  const k = useChatKeys({
    chat,
    state,
    mode: props.inputMode ?? 'multi',
    approvalSettleMs: props.approvalSettleMs,
    notifier: props.notifier,
    onKey,
  });
  const { input, expanded, noting, viewing, setViewing, menu, menuItems, at, slashQuery, atQuery } =
    k;

  // The live turn.
  const busy = state.phase === 'running';
  const animate = !props.reducedMotion && busy;
  const spin = theme.symbols.spinner;
  const frame = useFrame(animate, spin.length);
  const glyph = animate ? (spin[frame] as string) : theme.symbols.running;
  const title = reasoningTitle(state.reasoning);
  const thinking =
    busy && state.showThinking && title && !state.streaming ? `Thinking: ${title}` : undefined;
  const secs = state.turnStartedAt ? Math.floor((Date.now() - state.turnStartedAt) / 1000) : 0;
  const narration = useSettled(
    narrate({ ...state, secs: animate ? secs : undefined, thinkingTitle: title }),
    1000,
  );
  const live: LiveInput = {
    streaming: state.streaming,
    tools: state.tools,
    plan: state.plan,
    queue: state.queue,
    retrying: state.retrying,
    thinking,
    spinner: glyph,
    now: Date.now(),
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: `live` is rebuilt each render; these are its parts
  const all = useMemo(() => {
    const body = buildRows(cache.current, state.items, live, width, theme);
    return body.length || busy
      ? body
      : introRows({
          theme,
          model: state.model ?? props.subtitle,
          workspace: props.workspace,
          examples: EXAMPLES,
        });
  }, [
    state.items,
    state.streaming,
    state.tools,
    state.plan,
    state.queue,
    state.retrying,
    thinking,
    glyph,
    width,
    theme,
    state.model,
    busy,
  ]);

  // Geometry of the bottom slot decides how tall the session is.
  const panelOpen = Boolean(state.overlay || state.picker);
  const card = state.phase === 'waiting_approval' ? state.approvalView : undefined;
  const showPrompt = !panelOpen && (!card || noting);
  const cardRoom = Math.max(APPROVAL_ROWS, rows - 12);
  const boxRows = promptBoxRows(input, width, layout.promptMaxRows);
  const menuH = showPrompt && menu ? menuRows(menuItems.length) : 0;
  const slot = panelOpen
    ? PANEL_ROWS
    : (card ? approvalHeight(card, expanded, cardRoom) : 0) +
      (showPrompt ? menuH + boxRows + 1 : 0);
  const height = Math.max(1, rows - slot - 2);
  geometry.current = { total: all.length, height };
  const top = topOf(scroll, all.length, height);

  // Sending a message brings the session back to the end.
  const last = state.items.at(-1);
  useEffect(() => {
    if (last?.kind === 'user') setScroll(toBottom());
  }, [last]);

  const provider = useMemo(() => {
    try {
      return chat.models().find((c) => c.model === state.model)?.provider;
    } catch {
      return undefined;
    }
  }, [chat, state.model]);

  if (viewing)
    return h(TranscriptView, {
      items: state.items,
      columns,
      rows,
      theme,
      onClose: () => setViewing(false),
    });

  const model = state.model ?? props.subtitle;
  const query = slashQuery ?? atQuery ?? '';
  return h(
    Box,
    { flexDirection: 'column', width: columns, height: rows, paddingX: 2, paddingBottom: 1 },
    h(Viewport, { rows: all, top, height, width, theme }),
    h(
      Box,
      { flexDirection: 'column', flexShrink: 0, marginTop: 1, width },
      panelOpen
        ? h(
            Box,
            { flexDirection: 'column', height: PANEL_ROWS, overflow: 'hidden' },
            state.picker
              ? h(SessionPicker, {
                  rows: state.picker,
                  theme,
                  onPick: (id) => void chat.resume(id),
                  onCancel: () => chat.closePicker(),
                })
              : h(Overlay, { chat, state, theme, onTranscript: () => setViewing(true) }),
          )
        : null,
      card
        ? h(ApprovalCard, {
            view: card,
            theme,
            columns: width,
            expanded,
            room: cardRoom,
            noting,
            indent: 0,
          })
        : null,
      showPrompt && menu ? h(Menu, { items: menuItems, at, theme, indent: 1, query }) : null,
      showPrompt
        ? h(PromptBox, {
            value: input,
            theme,
            width,
            maxRows: layout.promptMaxRows,
            focused: state.phase === 'idle' || noting,
            placeholder: `Ask anything… "${EXAMPLES[0]}"`,
            model,
            provider,
          })
        : null,
      showPrompt
        ? h(StatusRow, {
            theme,
            width,
            working: busy ? { spinner: glyph, narration } : undefined,
            workspace: props.workspace,
            contextPct:
              state.contextWindow && state.contextTokens > 0
                ? Math.min(100, (state.contextTokens / state.contextWindow) * 100)
                : undefined,
            costUsd: state.costUsd,
          })
        : null,
    ),
  );
}
