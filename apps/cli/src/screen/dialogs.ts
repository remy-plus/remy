// The panels of the full-screen chat as centered dialogs: the command palette, the model list,
// the session list and the login flow. Each keeps the behaviour and copy of its classic panel.
import { useInput } from 'ink';
import { createElement as h, type ReactElement, useState } from 'react';
import { type Chat, type ChatState, type ModelChoice, shortId } from '../chat.ts';
import { COMMANDS } from '../commands.ts';
import { defaultModelFor } from '../login.ts';
import { LoginFlow } from '../login-ui.ts';
import { cheapChoice } from '../onboarding.ts';
import { themeItems } from '../overlay-ui.ts';
import type { ThemeChoice } from '../prefs.ts';
import type { ProfileStore } from '../profile.ts';
import { ProfilePanel } from '../profile-ui.ts';
import { ageWord, stateWord } from '../session-picker.ts';
import type { Theme } from '../theme.ts';
import { Dialog, type DialogSizeName, dialogSize } from './dialog.ts';
import {
  type DialogItem,
  DialogList,
  type DialogState,
  dialogKey,
  initialDialogState,
  shownItems,
} from './dialog-list.ts';

const choiceId = (c: ModelChoice) => `${c.provider}\t${c.model}`;

/** Where each command sits in the palette. */
const GROUPS: Record<string, string> = {
  new: 'Session',
  clear: 'Session',
  sessions: 'Session',
  exit: 'Session',
  model: 'Model',
  login: 'Model',
  thinking: 'View',
  theme: 'View',
  minimal: 'View',
  help: 'Help',
};

/** The palette's items: commands by group, then the view actions. */
export function paletteItems(): DialogItem[] {
  const group = (c: (typeof COMMANDS)[number]) => GROUPS[c.name] ?? 'Help';
  const by = (g: string): DialogItem[] =>
    COMMANDS.filter((c) => group(c) === g).map((c) => ({
      id: c.name,
      title: c.summary,
      detail: [`/${c.name}`, c.keys].filter(Boolean).join(' · '),
      group: g,
    }));
  return [
    ...by('Session'),
    ...by('Model'),
    ...by('View'),
    { id: '#sidebar', title: 'Show or hide the sidebar', detail: 'Ctrl+B', group: 'View' },
    { id: '#transcript', title: 'Read the whole conversation', detail: 'Ctrl+O', group: 'View' },
    ...by('Help'),
  ];
}

/** A dialog with a search field and a grouped list; the caller decides what a pick does. */
export function ListDialog(p: {
  title: string;
  items: DialogItem[];
  theme: Theme;
  columns: number;
  rows: number;
  size?: DialogSizeName;
  placeholder?: string;
  /** The item highlighted when the dialog opens. */
  initialId?: string;
  /** Rows made from what was typed, shown with the matches (for example "Use this model id"). */
  extra?: (query: string) => DialogItem[];
  onPick: (item: DialogItem) => void;
  onClose: () => void;
}): ReactElement {
  const [st, setSt] = useState<DialogState>(() => {
    const at = p.initialId ? shownItems(p.items, '').findIndex((i) => i.id === p.initialId) : -1;
    return at > 0 ? { query: '', at } : initialDialogState;
  });
  const size = p.size ?? 'medium';
  const all = [...p.items, ...(st.query.trim() ? (p.extra?.(st.query.trim()) ?? []) : [])];
  useInput((ch, key) => {
    if (key.ctrl && ch === 'c') return p.onClose();
    const r = dialogKey(st, ch, key, { items: all });
    setSt(r.state);
    if (r.action?.type === 'close') return p.onClose();
    if (r.action?.type === 'pick') p.onPick(r.action.item);
  });
  const g = dialogSize(p.columns, p.rows, size);
  return h(
    Dialog,
    { title: p.title, theme: p.theme, columns: p.columns, rows: p.rows, size },
    h(DialogList, {
      items: all,
      state: st,
      theme: p.theme,
      width: g.inner,
      rows: g.listRows,
      ...(p.placeholder && { placeholder: p.placeholder }),
    }),
  );
}

/** The login, model, palette and session dialogs, in place of the classic panels. */
export function Dialogs(p: {
  chat: Chat;
  state: ChatState;
  theme: Theme;
  columns: number;
  rows: number;
  onTranscript: () => void;
  onSidebar: () => void;
  profile?: ProfileStore;
  /** The tour is on: the model list highlights a cheap default. */
  touring?: boolean;
}): ReactElement | null {
  const { chat, state, theme, columns, rows } = p;
  const close = () => chat.closeOverlay();
  const frame = { theme, columns, rows };
  if (state.picker) {
    const now = Date.now();
    return h(ListDialog, {
      ...frame,
      title: 'Resume which task?',
      size: 'large',
      placeholder: 'Search tasks',
      items: state.picker.map((r) => ({
        id: r.taskId,
        title: r.title,
        detail: `${shortId(r.taskId)} · ${stateWord(r.status)} · ${ageWord(r.updatedAt, now)}`,
      })),
      onPick: (item) => void chat.resume(item.id),
      onClose: () => chat.closePicker(),
    });
  }
  if (state.overlay === 'login')
    return h(LoginFlow, {
      providers: chat.providers(),
      theme,
      dialog: { columns, rows },
      ...(!state.model && {
        intro: 'Remy needs a model to think with. Pick a provider; the key stays on this computer.',
      }),
      onSubmit: (entry) => chat.saveLogin(entry),
      onDone: () => chat.closeOverlay('login'),
      onCancel: () => chat.closeOverlay('login'),
    });
  if (state.overlay === 'model') {
    const choices = chat.models();
    const items: DialogItem[] = [
      ...choices.map((c) => ({
        id: choiceId(c),
        title: c.model,
        detail: `${c.provider} · ${c.detail}${c.model === state.model ? ' · in use' : ''}`,
      })),
      { id: '#login', title: 'Connect another provider', detail: '/login' },
    ];
    const provider = choices.find((c) => c.model === state.model)?.provider ?? choices[0]?.provider;
    const cheap = p.touring ? cheapChoice(choices, state.model, defaultModelFor) : undefined;
    return h(ListDialog, {
      ...frame,
      title: p.touring ? 'Pick a model' : 'Switch model',
      ...(cheap && { initialId: choiceId(cheap) }),
      items,
      placeholder: 'Search models',
      extra: (q) =>
        provider && !choices.some((c) => c.model === q)
          ? [{ id: `#use\t${provider}\t${q}`, title: `Use "${q}"`, detail: `on ${provider}` }]
          : [],
      onPick: (item) => {
        if (item.id === '#login') return chat.openOverlay('login');
        const [kind, a, b] = item.id.split('\t');
        if (kind === '#use') return void chat.chooseModel(a as string, b as string);
        void chat.chooseModel(kind as string, a as string);
      },
      onClose: close,
    });
  }
  if (state.overlay === 'profile' && p.profile)
    return h(ProfilePanel, {
      profile: p.profile,
      theme,
      dialog: { columns, rows },
      onClose: () => chat.closeOverlay('profile'),
    });
  if (state.overlay === 'theme')
    return h(ListDialog, {
      ...frame,
      title: 'Theme',
      size: 'small',
      items: themeItems(state.theme).map((i) => ({ ...i, group: undefined })),
      onPick: (item) => chat.setTheme(item.id as ThemeChoice),
      onClose: close,
    });
  if (state.overlay === 'palette')
    return h(ListDialog, {
      ...frame,
      title: 'Commands',
      items: paletteItems(),
      placeholder: 'Type a command',
      onPick: (item) => {
        if (item.id === '#transcript') {
          chat.closeOverlay();
          return p.onTranscript();
        }
        if (item.id === '#sidebar') {
          chat.closeOverlay();
          return p.onSidebar();
        }
        void chat.runCommand(item.id);
      },
      onClose: close,
    });
  return null;
}
