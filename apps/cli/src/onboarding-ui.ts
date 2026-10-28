// The tour's screens as thin components over the reducers in onboarding.ts. Each question owns its
// keys; the caller decides what a finished answer does. `inline` is the minimal-screen layout:
// left aligned, no wordmark, drawn in the flow of the terminal instead of centred on a screen.
import { Box, Text, useInput } from 'ink';
import { createElement as h, type ReactElement, type ReactNode, useState } from 'react';
import { GOALS } from './goals.ts';
import { Hints } from './hints.ts';
import {
  CUSTOM_ROW,
  type GoalsState,
  goalsKey,
  goalsStart,
  nameKey,
  yesNoKey,
} from './onboarding.ts';
import type { Theme } from './theme.ts';
import { WORDMARK, WORDMARK_WIDTH } from './wordmark.ts';

export interface FrameProps {
  theme: Theme;
  columns: number;
  rows: number;
  /** The minimal screen: left aligned, no wordmark. */
  inline?: boolean;
  /** Only the question, for a caller that supplies the frame (the /profile dialog). */
  bare?: boolean;
}

/** Widest a question is drawn. */
export const CONTENT_MAX = 64;

const FULL_MARK_ROWS = 22;

function Mark(p: { theme: Theme; columns: number; rows: number }): ReactElement {
  const full = p.rows >= FULL_MARK_ROWS && p.columns >= WORDMARK_WIDTH + 4;
  if (!full) return h(Text, { bold: true }, 'REMY');
  return h(
    Box,
    { flexDirection: 'column', alignItems: 'center', flexShrink: 0 },
    ...WORDMARK.map((line, i) => {
      const color = p.theme.ramp(i, WORDMARK.length);
      return h(Text, { key: i, ...(color ? { color } : {}) }, line.padEnd(WORDMARK_WIDTH));
    }),
  );
}

/** The frame every step sits in: centred on the screen, or in the flow of the terminal. */
export function Shell(p: FrameProps & { mark?: boolean; children?: ReactNode }): ReactElement {
  const width = Math.max(20, Math.min(CONTENT_MAX, p.columns - 4));
  if (p.bare) return h(Box, { flexDirection: 'column' }, p.children);
  if (p.inline)
    return h(
      Box,
      { flexDirection: 'column', paddingLeft: p.theme.space.indent, marginTop: 1, width },
      p.children,
    );
  return h(
    Box,
    {
      width: p.columns,
      height: p.rows,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      paddingX: 2,
    },
    p.mark ? h(Mark, { theme: p.theme, columns: p.columns, rows: p.rows }) : null,
    p.mark ? h(Box, { height: 1, flexShrink: 0 }) : null,
    h(Box, { flexDirection: 'column', width, flexShrink: 0 }, p.children),
  );
}

/** Just the wordmark: behind the login and model dialogs. */
export const Backdrop = (p: FrameProps): ReactElement =>
  h(Shell, { ...p, mark: true }, p.inline ? null : h(Box, { height: 6 }));

const sub = (theme: Theme, text: string, key?: string) =>
  h(Text, { key, ...theme.props('muted'), wrap: 'wrap' }, text);

/** A question: "2 of 7" in muted type, the question in bold, a line of explanation, then the body. */
function Ask(p: {
  theme: Theme;
  progress?: { at: number; of: number };
  title: string;
  note?: string;
  hint: string;
  children?: ReactNode;
}): ReactElement {
  const { theme } = p;
  return h(
    Box,
    { flexDirection: 'column' },
    p.progress ? sub(theme, `${p.progress.at} of ${p.progress.of}`) : null,
    h(Text, { bold: true, wrap: 'wrap' }, p.title),
    p.note ? sub(theme, p.note) : null,
    h(Box, { height: 1 }),
    p.children,
    h(Box, { height: 1 }),
    h(Hints, { hint: p.hint, theme }),
  );
}

type Progress = { at: number; of: number } | undefined;

export function WelcomeView(p: FrameProps & { onDone: () => void; onSkip: () => void }) {
  useInput((_ch, key) => {
    if (key.escape) return p.onSkip();
    if (key.return) p.onDone();
  });
  return h(
    Shell,
    { ...p, mark: true },
    h(
      Box,
      { flexDirection: 'column', alignItems: p.inline ? 'flex-start' : 'center' },
      p.inline ? h(Text, { bold: true }, 'Welcome to Remy') : null,
      h(Text, null, 'A few questions, then a first task. It takes about two minutes.'),
      h(Box, { height: 1 }),
      h(Hints, { hint: 'Enter to begin · Esc to skip', theme: p.theme }),
    ),
  );
}

export function NameView(
  p: FrameProps & {
    progress?: Progress;
    initial?: string;
    onDone: (name: string) => void;
    onSkip: () => void;
    /** Hint text; /profile says "save" instead of "continue". */
    verb?: string;
  },
) {
  const [value, setValue] = useState(p.initial ?? '');
  useInput((ch, key) => {
    if (key.escape || (key.ctrl && ch === 'c')) return p.onSkip();
    const r = nameKey(value, ch, key);
    setValue(r.state);
    if (r.done !== undefined) p.onDone(r.done);
  });
  const { theme } = p;
  const accent = theme.color('accent');
  return h(
    Shell,
    p,
    h(
      Ask,
      {
        theme,
        progress: p.progress,
        title: 'What should I call you?',
        note: 'Optional. It stays on this computer.',
        hint: `Enter ${p.verb ?? 'continue'} · Esc skip`,
      },
      h(
        Box,
        null,
        h(Text, theme.props('muted'), `${theme.symbols.prompt} `),
        h(Text, null, value),
        h(Text, accent ? { color: accent } : {}, theme.symbols.cursor),
      ),
    ),
  );
}

export function GoalsView(
  p: FrameProps & {
    progress?: Progress;
    initial?: readonly string[];
    onDone: (goals: string[]) => void;
    onSkip: () => void;
    verb?: string;
  },
) {
  const [st, setSt] = useState<GoalsState>(() => goalsStart(p.initial));
  useInput((ch, key) => {
    if (key.escape || (key.ctrl && ch === 'c')) return p.onSkip();
    const r = goalsKey(st, ch, key);
    setSt(r.state);
    if (r.done) p.onDone(r.done);
  });
  const { theme } = p;
  const muted = theme.props('muted');
  const accent = theme.color('accent');
  const accentProps = accent ? { color: accent } : {};
  const row = (i: number, on: boolean, picked: boolean, content: ReactNode) =>
    h(
      Box,
      { key: i },
      h(Text, on ? accentProps : muted, on ? `${theme.symbols.prompt} ` : '  '),
      h(Text, picked ? accentProps : muted, picked ? '[x] ' : '[ ] '),
      content,
    );
  return h(
    Shell,
    p,
    h(
      Ask,
      {
        theme,
        progress: p.progress,
        title: 'What do you mostly want help with?',
        note: 'Pick one or more, or type your own.',
        hint: `↑↓ move · Space pick · Enter ${p.verb ?? 'continue'} · Esc skip`,
      },
      ...GOALS.map((g, i) =>
        row(
          i,
          st.at === i,
          st.picked.includes(g.id),
          h(Text, st.at === i ? { bold: true } : {}, g.label),
        ),
      ),
      row(
        CUSTOM_ROW,
        st.at === CUSTOM_ROW,
        st.custom.trim().length > 0,
        st.custom || st.at === CUSTOM_ROW
          ? h(
              Text,
              null,
              st.custom,
              h(Text, accentProps, st.at === CUSTOM_ROW ? theme.symbols.cursor : ''),
            )
          : h(Text, muted, 'Something else'),
      ),
    ),
  );
}

export function PersonaliseView(
  p: FrameProps & {
    progress?: Progress;
    initial?: boolean;
    onDone: (on: boolean) => void;
    onSkip: () => void;
  },
) {
  const [on, setOn] = useState(p.initial ?? true);
  useInput((ch, key) => {
    if (key.escape || (key.ctrl && ch === 'c')) return p.onSkip();
    const r = yesNoKey(on, ch, key);
    setOn(r.state);
    if (r.done !== undefined) p.onDone(r.done);
  });
  const { theme } = p;
  const accent = theme.color('accent');
  const choice = (label: string, active: boolean) =>
    h(
      Text,
      active ? { bold: true, ...(accent ? { color: accent } : {}) } : theme.props('muted'),
      `${active ? `${theme.symbols.prompt} ` : '  '}${label}`,
    );
  return h(
    Shell,
    p,
    h(
      Ask,
      {
        theme,
        progress: p.progress,
        title: 'Use this to personalise replies?',
        note: 'Remy sends your name and goals to your own model as one line of context. Nothing else leaves this computer.',
        hint: 'Y yes · N no · Enter confirm · Esc skip',
      },
      choice('Yes', on),
      choice('No', !on),
    ),
  );
}

export function OfferView(
  p: FrameProps & {
    progress?: Progress;
    prompt: string;
    /** Sample files that will be made in the scratch folder first. */
    sampleFiles: number;
    onRun: () => void;
    onPass: () => void;
    onSkip: () => void;
  },
) {
  useInput((ch, key) => {
    if (key.escape || (key.ctrl && ch === 'c')) return p.onSkip();
    if (key.return) return p.onRun();
    if (!key.ctrl && !key.meta && ch.toLowerCase() === 's') p.onPass();
  });
  const { theme } = p;
  const accent = theme.color('accent');
  return h(
    Shell,
    p,
    h(
      Ask,
      {
        theme,
        progress: p.progress,
        title: 'Ready for a first task?',
        note: p.sampleFiles
          ? `Remy runs it for real, with your model, in a scratch folder. It makes ${p.sampleFiles} sample files there first and asks before it moves anything.`
          : 'Remy runs it for real, with your model, in a scratch folder. Nothing outside it is touched.',
        hint: 'Enter run it · S skip the task · Esc skip the rest',
      },
      h(
        Box,
        null,
        h(Text, accent ? { color: accent } : {}, `${theme.symbols.quote} `),
        h(Text, { wrap: 'wrap' }, p.prompt),
      ),
    ),
  );
}

export function KeysView(p: FrameProps & { onDone: () => void }) {
  useInput((ch, key) => {
    if (key.escape || key.return || (key.ctrl && ch === 'c')) p.onDone();
  });
  const { theme } = p;
  const muted = theme.props('muted');
  const keys: [string, string][] = [
    ['Ctrl+P', 'commands, models and sessions'],
    ['@file', 'attach a file from this folder'],
    ['/', 'see every command'],
  ];
  return h(
    Shell,
    p,
    h(
      Ask,
      { theme, title: 'Three keys to remember', hint: 'Enter to finish' },
      ...keys.map(([k, what]) =>
        h(
          Box,
          { key: k },
          h(Box, { width: 9, flexShrink: 0 }, h(Text, { bold: true }, k)),
          h(Text, muted, what),
        ),
      ),
    ),
  );
}

/** One line above the prompt during the first task. */
export function TaskStrip(p: { theme: Theme; running: boolean }): ReactElement {
  return h(Hints, {
    hint: p.running
      ? 'First task · Esc stops it and finishes the tour'
      : 'First task done · Enter to continue · Esc to finish',
    theme: p.theme,
  });
}
