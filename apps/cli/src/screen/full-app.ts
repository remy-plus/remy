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
import type { ChatState } from '../chat.ts';
import { useChatKeys } from '../chat-keys.ts';
import type { ChatAppProps } from '../chat-ui.ts';
import { EXAMPLES } from '../examples.ts';
import { type InputState, withText } from '../input.ts';
import {
  currentMatch,
  SEARCH_START,
  type SearchKey,
  type SearchState,
  searchKey,
} from '../input-history.ts';
import { Menu, menuRows } from '../picker.ts';
import { APPROVAL_ROWS, approvalHeight, narrate, reasoningTitle } from '../transcript.ts';
import { TranscriptView } from '../transcript-view.ts';
import { buildRows, createRowCache, type LiveInput } from './compose.ts';
import { Dialogs } from './dialogs.ts';
import { Home } from './home.ts';
import { introRows } from './intro.ts';
import { computeLayout, SIDEBAR_MIN_COLUMNS, SIDEBAR_WIDTH } from './layout.ts';
import { fadeColor, formatElapsed, useElapsed, useFadeIn, useThrottled } from './motion.ts';
import { PromptBox, promptBoxRows } from './prompt-box.ts';
import {
  halfUp,
  pageDown,
  pageUp,
  SCROLL_START,
  type Scroll,
  toBottom,
  topOf,
  toTop,
} from './scroll.ts';
import { Sidebar } from './sidebar.ts';
import { SCAN_WIDTH, Scanner, useSpinner } from './spinner.ts';
import { statusLine } from './status.ts';
import { pickTip } from './tips.ts';
import { Viewport } from './viewport.ts';

/** The hint in an empty prompt: an example, rotating with each message sent; or the question's cue. */
function placeholderFor(state: ChatState): string {
  if (state.phase === 'waiting_user') return 'Type your answer…';
  if (state.phase === 'waiting_approval') return 'Say why, then Enter…';
  const sent = state.items.filter((i) => i.kind === 'user').length;
  return `Ask anything… "${EXAMPLES[sent % EXAMPLES.length]}"`;
}

function StatusRow(p: {
  theme: ChatAppProps['theme'];
  width: number;
  working?: { narration: string; reducedMotion: boolean };
  workspace?: string;
  contextPct?: number;
  costUsd?: number;
}): ReactElement {
  const { theme } = p;
  const muted = theme.props('muted');
  // The scanner takes eight columns and a space where the old spinner took one and a space.
  const lead = SCAN_WIDTH + 1;
  const s = statusLine({
    ...p,
    working: p.working && { spinner: ' '.repeat(SCAN_WIDTH), narration: p.working.narration },
    width: p.width - 1,
  });
  const right = s.right.endsWith('ctrl+p commands')
    ? s.right.slice(0, -'ctrl+p commands'.length)
    : s.right;
  return h(
    Box,
    { width: p.width, paddingLeft: 1, flexShrink: 0 },
    h(
      Box,
      { flexGrow: 1, flexShrink: 1 },
      p.working && s.left.length >= lead
        ? h(Scanner, {
            active: true,
            level: theme.level,
            width: SCAN_WIDTH,
            reducedMotion: p.working.reducedMotion,
          })
        : null,
      h(
        Text,
        { wrap: 'truncate-end', ...muted },
        p.working && s.left.length >= lead ? s.left.slice(SCAN_WIDTH) : s.left,
      ),
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
  const { chat } = props;
  const state = useSyncExternalStore(chat.subscribe, chat.getState);
  const { themeFor } = props;
  const theme = useMemo(
    () => (themeFor ? themeFor(state.theme) : props.theme),
    [themeFor, state.theme, props.theme],
  );
  const { columns, rows } = useWindowSize();
  const [sidebarOn, setSidebarOn] = useState(true);
  const [overlayOn, setOverlayOn] = useState(false);
  const columnsRef = useRef(columns);
  columnsRef.current = columns;
  const layout = computeLayout(columns, rows, {
    sidebar: sidebarOn && (state.items.length > 0 || state.phase === 'running'),
  });
  const width = layout.contentWidth;
  const cache = useRef(createRowCache());
  const [scroll, setScroll] = useState<Scroll>(SCROLL_START);
  const overlayRef = useRef(false);
  overlayRef.current = overlayOn;
  const geometry = useRef({ total: 0, height: 1 });

  const [search, setSearch] = useState<SearchState | undefined>();
  const searchRef = useRef<SearchState | undefined>(undefined);
  const setInputRef = useRef<((i: InputState) => void) | undefined>(undefined);
  const onKey = useCallback(
    (
      ch: string,
      key: SearchKey & {
        pageUp?: boolean;
        pageDown?: boolean;
        home?: boolean;
        end?: boolean;
      },
      input: { text: string },
    ) => {
      // Ctrl+R: reverse search through what was sent before. Enter takes the match to edit.
      const find = searchRef.current;
      if (find) {
        const step = searchKey(find, chat.history(), ch, key);
        if ('accept' in step) setInputRef.current?.(withText(step.accept));
        const next = 'state' in step ? step.state : undefined;
        searchRef.current = next;
        setSearch(next);
        return true;
      }
      if (key.ctrl && ch === 'r' && chat.getState().phase === 'idle' && chat.history().length) {
        searchRef.current = SEARCH_START;
        setSearch(SEARCH_START);
        return true;
      }
      const { total, height } = geometry.current;
      if (key.pageUp) return (setScroll((s) => pageUp(s, total, height)), true);
      if (key.pageDown) return (setScroll((s) => pageDown(s, total, height)), true);
      if (!input.text && key.ctrl && ch === 'u')
        return (setScroll((s) => halfUp(s, total, height)), true);
      if (!input.text && key.home) return (setScroll(toTop(total, height)), true);
      if (!input.text && key.end) return (setScroll(toBottom()), true);
      if (key.ctrl && ch === 'b') {
        if (columnsRef.current > SIDEBAR_MIN_COLUMNS) setSidebarOn((on) => !on);
        else setOverlayOn((on) => !on);
        return true;
      }
      if (key.escape && overlayRef.current) return (setOverlayOn(false), true);
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
  setInputRef.current = k.setInput;
  const {
    input: typed,
    expanded,
    noting,
    viewing,
    setViewing,
    menu,
    menuItems,
    at,
    slashQuery,
    atQuery,
  } = k;
  // While searching, the prompt shows the match instead of what was typed.
  const match = search ? currentMatch(search, chat.history()) : undefined;
  const input = search ? withText(match ?? '') : typed;

  // The live turn.
  const busy = state.phase === 'running';
  const animate = !props.reducedMotion && busy;
  const glyph = useSpinner(busy, { reducedMotion: props.reducedMotion });
  const title = reasoningTitle(state.reasoning);
  const thinking =
    busy && state.showThinking && title && !state.streaming ? `Thinking: ${title}` : undefined;
  const secs = useElapsed(animate ? state.turnStartedAt : undefined);
  const narration = useThrottled(
    narrate({ ...state, secs: animate ? secs : undefined, thinkingTitle: title }).replace(
      / · \d+s$/,
      ` · ${formatElapsed(secs)}`,
    ),
    250,
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
  const showPrompt = !card || noting;
  const cardRoom = Math.max(APPROVAL_ROWS, rows - 12);
  const boxRows = promptBoxRows(input, width, layout.promptMaxRows);
  const menuH = showPrompt && menu && !panelOpen ? menuRows(menuItems.length) : 0;
  const slot =
    (card ? approvalHeight(card, expanded, cardRoom) : 0) + (showPrompt ? menuH + boxRows + 1 : 0);
  const height = Math.max(1, rows - slot - 2);
  geometry.current = { total: all.length, height };
  const top = topOf(scroll, all.length, height);

  // A calm fade-in for a finished reply's footer and for the provider in the prompt's meta row.
  const motion = !props.reducedMotion && theme.level === 'truecolor';
  const replies = state.items.filter((i) => i.kind === 'reply').length;
  const replyFade = useFadeIn(replies, motion ? 150 : 0);
  const rowsShown = useMemo(() => {
    const muted = theme.color('muted');
    if (replyFade >= 1 || !muted || !theme.surface) return all;
    for (let i = all.length - 1; i >= 0; i--) {
      const r = all[i] as (typeof all)[number];
      if (!r.spans[0]?.text.startsWith('▣')) continue;
      const color = fadeColor(theme.surface, muted, replyFade);
      const faded = { ...r, spans: r.spans.map((sp) => ({ ...sp, color })) };
      return [...all.slice(0, i), faded, ...all.slice(i + 1)];
    }
    return all;
  }, [all, replyFade, theme]);

  // Sending a message brings the session back to the end.
  const last = state.items.at(-1);
  useEffect(() => {
    if (last?.kind === 'user') setScroll(toBottom());
  }, [last]);

  const tip = useMemo(() => pickTip(Math.floor(Date.now() / 86_400_000)), []);
  const provider = useMemo(() => {
    try {
      return chat.models().find((c) => c.model === state.model)?.provider;
    } catch {
      return undefined;
    }
  }, [chat, state.model]);

  const metaFade = useFadeIn(provider ?? '', motion ? 150 : 0);

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
  // Nothing said yet: the home screen, with the prompt in its middle. The first message leaves it.
  const dialog = panelOpen
    ? h(Dialogs, {
        chat,
        state,
        theme,
        columns,
        rows,
        onTranscript: () => setViewing(true),
        onSidebar: () => setSidebarOn((on) => !on),
      })
    : null;
  if (state.items.length === 0 && state.phase === 'idle')
    return h(
      Box,
      { width: columns, height: rows },
      h(Home, {
        theme,
        columns,
        rows,
        version: props.version ?? '',
        workspace: props.workspace ?? process.cwd(),
        tip,
        prompt: h(
          Box,
          { flexDirection: 'column' },
          menu && !panelOpen
            ? h(Menu, {
                items: menuItems,
                at,
                theme,
                indent: 1,
                query,
                ...(theme.element && {
                  fill: { color: theme.element, width: layout.homePromptWidth },
                }),
              })
            : null,
          h(PromptBox, {
            value: input,
            theme,
            width: layout.homePromptWidth,
            maxRows: layout.promptMaxRows,
            focused: !panelOpen,
            placeholder: placeholderFor(state),
            model,
            provider,
            search: search?.query,
            fade: metaFade,
          }),
        ),
      }),
      dialog,
    );
  const main = columns - layout.sidebarWidth;
  const overlayWidth = Math.min(SIDEBAR_WIDTH, Math.max(20, columns - 8));
  return h(
    Box,
    { width: columns, height: rows },
    h(
      Box,
      { flexDirection: 'column', width: main, height: rows, paddingX: 2, paddingBottom: 1 },
      h(Viewport, { rows: rowsShown, top, height, width, theme }),
      h(
        Box,
        { flexDirection: 'column', flexShrink: 0, marginTop: 1, width },
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
        showPrompt && menu && !panelOpen
          ? h(Menu, {
              items: menuItems,
              at,
              theme,
              indent: 1,
              query,
              ...(theme.element && { fill: { color: theme.element, width } }),
            })
          : null,
        showPrompt
          ? h(PromptBox, {
              value: input,
              theme,
              width,
              maxRows: layout.promptMaxRows,
              focused: !panelOpen && (state.phase === 'idle' || noting),
              placeholder: placeholderFor(state),
              model,
              provider,
              search: search?.query,
              fade: metaFade,
            })
          : null,
        showPrompt
          ? h(StatusRow, {
              theme,
              width,
              working: busy
                ? { narration, reducedMotion: Boolean(props.reducedMotion) }
                : undefined,
              workspace: props.workspace,
              contextPct:
                state.contextWindow && state.contextTokens > 0
                  ? Math.min(100, (state.contextTokens / state.contextWindow) * 100)
                  : undefined,
              costUsd: state.costUsd,
            })
          : null,
      ),
    ),
    layout.sidebar === 'inline'
      ? h(Sidebar, { state, theme, height: rows, width: layout.sidebarWidth })
      : null,
    layout.sidebar === 'none' && overlayOn
      ? h(
          Box,
          { position: 'absolute', top: 0, right: 0, width: overlayWidth, height: rows },
          h(Sidebar, { state, theme, height: rows, width: overlayWidth }),
        )
      : null,
    dialog,
  );
}
