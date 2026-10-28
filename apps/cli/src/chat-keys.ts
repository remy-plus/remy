// Keys and input state of the chat, shared by the classic and the full-screen screens: the
// editor, history, autocomplete, the approval card's keys, paste, and quitting.
import { useApp, useInput, usePaste } from 'ink';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Chat, ChatState } from './chat.ts';
import { matchCommands } from './commands.ts';
import {
  EMPTY_INPUT,
  editInput,
  type InputMode,
  type InputState,
  moveLine,
  pasteInput,
  pressEnter,
  recallInput,
  withText,
} from './input.ts';
import { applyMention, atToken } from './mentions.ts';
import type { PickItem } from './picker.ts';
import { isFocusReport, type Notifier } from './terminal.ts';

/** How long a new approval card ignores y / n / e / v, so type-ahead cannot answer it. */
export const APPROVAL_SETTLE_MS = 500;

export interface ChatKeysOptions {
  chat: Chat;
  state: ChatState;
  mode: InputMode;
  /** Overrides `APPROVAL_SETTLE_MS` (tests use 0). */
  approvalSettleMs?: number;
  notifier?: Notifier;
  /** The tour has the screen: the prompt reads no keys and takes no paste. */
  paused?: boolean;
  onClear?: () => void;
  /** Called when the theme changes after the first render. */
  onRetheme?: () => void;
  /** First look at a key while the prompt is active; return true when it was handled. */
  onKey?: (
    ch: string,
    key: Parameters<Parameters<typeof useInput>[0]>[1],
    input: InputState,
  ) => boolean;
}

export function useChatKeys(o: ChatKeysOptions) {
  const { chat, state, mode } = o;
  const { exit } = useApp();
  const [input, setInput] = useState<InputState>(EMPTY_INPUT);

  const recall = useRef(-1);
  const seenClears = useRef(state.clears);
  const seenTheme = useRef(state.theme);
  const [expanded, setExpanded] = useState(false);
  const [noting, setNoting] = useState(false);
  const [viewing, setViewing] = useState(false);
  const [menuAt, setMenuAt] = useState(0);
  const [files, setFiles] = useState<string[]>([]);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
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
    o.onClear?.();
  }, [state.clears, o.onClear]);

  useEffect(() => {
    if (state.theme === seenTheme.current) return;
    seenTheme.current = state.theme;
    o.onRetheme?.();
  }, [state.theme, o.onRetheme]);

  const { notifier } = o;
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

  const pausedSince = useRef(0);
  const pauseQ = state.pause?.question;
  useEffect(() => {
    if (pauseQ) pausedSince.current = Date.now();
  }, [pauseQ]);

  // The full view hides the live area, so it gives way when Remy needs an answer.
  useEffect(() => {
    if (state.phase !== 'idle' && state.phase !== 'running') setViewing(false);
  }, [state.phase]);

  // Autocomplete under the prompt: commands after a `/`, workspace files after an `@`.
  const idle = state.phase === 'idle';
  const slashQuery =
    idle && /^\/[^\s]*$/.test(input.text) && !state.overlay ? input.text.slice(1) : undefined;
  const slashItems: PickItem[] =
    slashQuery === undefined
      ? []
      : matchCommands(slashQuery).map((c) => ({
          id: c.name,
          title: `/${c.name}`,
          detail: c.summary,
        }));
  const tok =
    state.phase !== 'waiting_approval' && !state.overlay && !slashQuery
      ? atToken(input.text, input.cursor)
      : undefined;
  const atQuery = tok?.query;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the query is the trigger
  useEffect(() => {
    if (atQuery === undefined) return setFiles([]);
    let live = true;
    void chat.completeFiles(atQuery).then((f) => live && setFiles(f));
    return () => {
      live = false;
    };
  }, [atQuery]);
  const fileItems: PickItem[] =
    tok && hiddenFor !== input.text ? files.map((f) => ({ id: f, title: f })) : [];
  const menu: 'slash' | 'file' | undefined = slashItems.length
    ? 'slash'
    : fileItems.length
      ? 'file'
      : undefined;
  const menuItems = menu === 'slash' ? slashItems : fileItems;
  const at = Math.min(menuAt, Math.max(0, menuItems.length - 1));
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new query starts at the top
  useEffect(() => setMenuAt(0), [slashQuery, atQuery]);

  useInput((ch, key) => {
    // Streamed text yields to typing: frames get short for a moment after any key.
    chat.noteInput();
    // The transcript view, the pickers and the panels read their own keys.
    if (o.paused || viewing || state.picker || state.overlay) return;
    if (o.onKey?.(ch, key, input)) return;
    if (key.ctrl && ch === 'p' && idle) return chat.openOverlay('palette');
    if (menu) {
      if (key.upArrow || key.downArrow) {
        const n = menuItems.length;
        return setMenuAt((i) => (i + (key.upArrow ? -1 : 1) + n) % n);
      }
      const pick = menuItems[at];
      if (pick && (key.tab || key.return)) {
        if (menu === 'slash') {
          if (key.tab) return setInput(withText(`${pick.title} `));
          recall.current = -1;
          setInput(EMPTY_INPUT);
          return void chat.submit(pick.title);
        }
        const done = applyMention(input.text, input.cursor, pick.id);
        return setInput((cur) => ({ ...cur, ...done }));
      }
      if (key.escape && menu === 'file') return setHiddenFor(input.text);
    }
    // Focus reports are for the notifier, not the editor.
    if (isFocusReport(ch)) return;
    if (key.ctrl && ch === 'd') return void quit();
    if (key.ctrl && ch === 'o' && state.phase !== 'waiting_approval') return setViewing(true);
    if (key.ctrl && ch === 'c') {
      if (state.phase !== 'idle') return void chat.interrupt();
      if (input.text) return setInput(EMPTY_INPUT);
      return void quit();
    }
    if (state.phase === 'paused') {
      // Like an approval: single keys, never Enter, and not for the first moment.
      if (Date.now() - pausedSince.current < (o.approvalSettleMs ?? APPROVAL_SETTLE_MS)) return;
      if (/^y$/i.test(ch)) void chat.continueRun(true);
      else if (/^n$/i.test(ch)) void chat.continueRun(false);
      return;
    }
    if (state.phase === 'waiting_approval') {
      if (noting) {
        if (key.escape) {
          setNoting(false);
          return setInput(EMPTY_INPUT);
        }
        if (key.return) {
          // An empty note does nothing: `n` is the plain denial.
          const sent = mode === 'multi' ? pressEnter(input) : { send: input.text };
          if ('state' in sent) return setInput(sent.state);
          const note = sent.send.trim();
          if (!note) return;
          setNoting(false);
          setInput(EMPTY_INPUT);
          return void chat.approve(false, note);
        }
        return setInput((cur) => editInput(cur, ch, key, mode));
      }
      // Single keys only, and never Enter: a pasted or stray character cannot approve.
      if (Date.now() - cardSince.current < (o.approvalSettleMs ?? APPROVAL_SETTLE_MS)) return;
      if (/^y$/i.test(ch)) void chat.approve(true);
      // Only a card that offers it: an irreversible or paid action never shows `a`.
      else if (/^a$/i.test(ch)) {
        if (state.approvalView?.always) void chat.approve(true, undefined, true);
      } else if (/^n$/i.test(ch)) void chat.approve(false);
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
    // Send now: stop the running turn and send this message in its place. Alt+Enter where the
    // terminal sends it as Esc+Enter, Ctrl+S everywhere (raw mode has no flow control).
    const sendNow = (key.return && key.meta) || (key.ctrl && ch === 's');
    if (key.ctrl && ch === 's' && state.phase !== 'running') return;
    if (key.return || sendNow) {
      const sent = mode === 'multi' ? pressEnter(input) : { send: input.text, pasted: [] };
      if ('state' in sent) return setInput(sent.state);
      if (sendNow && !sent.send.trim()) return;
      recall.current = -1;
      setInput(EMPTY_INPUT);
      return void (sendNow
        ? chat.sendNow(sent.send, sent.pasted)
        : chat.submit(sent.send, sent.pasted));
    }
    if (key.upArrow || key.downArrow) {
      // In a several-line message the arrows move between lines; history is for the ends.
      const moved = mode === 'multi' ? moveLine(input, key.upArrow ? -1 : 1) : undefined;
      if (moved) return setInput(moved);
      const past = chat.history();
      const next = Math.min(past.length - 1, Math.max(-1, recall.current + (key.upArrow ? 1 : -1)));
      recall.current = next;
      return setInput(next < 0 ? EMPTY_INPUT : recallInput(past[past.length - 1 - next] as string));
    }
    setInput((cur) => editInput(cur, ch, key, mode));
  });

  // Bracketed paste: a big paste becomes one marker. Only the prompt takes it; an approval
  // card or the full view swallows it, so pasted text can never answer a question.
  usePaste(
    (text) => {
      if (viewing || state.phase === 'paused' || (state.phase === 'waiting_approval' && !noting))
        return;
      setInput((cur) => pasteInput(cur, text));
    },
    { isActive: mode === 'multi' && !state.overlay && !o.paused },
  );
  return {
    input,
    setInput,
    expanded,
    noting,
    setNoting,
    viewing,
    setViewing,
    menu,
    menuItems,
    at,
    slashQuery,
    atQuery,
    idle,
  };
}
