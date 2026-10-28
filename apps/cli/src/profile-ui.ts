// /profile: shows what Remy knows about the user and edits it. Name and goals reuse the tour's
// questions; the personalise switch flips in place; delete asks first.
import { Box, Text, useInput } from 'ink';
import {
  createElement as h,
  type ReactElement,
  type ReactNode,
  useState,
  useSyncExternalStore,
} from 'react';
import { goalLabel } from './goals.ts';
import { Hints } from './hints.ts';
import { GoalsView, NameView } from './onboarding-ui.ts';
import type { Profile, ProfileStore } from './profile.ts';
import { Dialog } from './screen/dialog.ts';
import { moveSelection } from './session-picker.ts';
import type { Theme } from './theme.ts';

export interface ProfileRow {
  id: 'name' | 'goals' | 'personalise' | 'delete';
  label: string;
  detail: string;
}

/** The rows of the profile panel, with what each holds now. */
export function profileRows(profile: Profile | undefined): ProfileRow[] {
  return [
    { id: 'name', label: 'Name', detail: profile?.name || 'not set' },
    {
      id: 'goals',
      label: 'Mostly helps with',
      detail: profile?.goals.length ? profile.goals.map(goalLabel).join(', ') : 'not set',
    },
    {
      id: 'personalise',
      label: 'Personalise replies',
      detail: profile?.personalise === false ? 'off' : 'on',
    },
    { id: 'delete', label: 'Delete profile', detail: profile ? '' : 'nothing saved' },
  ];
}

type Mode = 'menu' | 'name' | 'goals' | 'delete';

export function ProfilePanel(p: {
  profile: ProfileStore;
  theme: Theme;
  /** Draw inside the centered dialog of the full-screen app. */
  dialog?: { columns: number; rows: number };
  onClose: () => void;
}): ReactElement {
  const { theme } = p;
  const profile = useSyncExternalStore(p.profile.subscribe, p.profile.get);
  const [mode, setMode] = useState<Mode>('menu');
  const [at, setAt] = useState(0);
  const rows = profileRows(profile);

  useInput(
    (ch, key) => {
      if (key.ctrl && ch === 'c') return p.onClose();
      if (mode === 'delete') {
        if (/^y$/i.test(ch)) {
          p.profile.remove();
          return p.onClose();
        }
        if (key.escape || /^n$/i.test(ch)) setMode('menu');
        return;
      }
      if (key.escape) return p.onClose();
      if (key.upArrow) return setAt((i) => moveSelection(i, -1, rows.length));
      if (key.downArrow || key.tab) return setAt((i) => moveSelection(i, 1, rows.length));
      if (!key.return) return;
      const row = rows[at] as ProfileRow;
      if (row.id === 'name' || row.id === 'goals') setMode(row.id);
      else if (row.id === 'personalise')
        p.profile.update({ personalise: !(profile?.personalise ?? true) });
      else if (profile) setMode('delete');
    },
    { isActive: mode === 'menu' || mode === 'delete' },
  );

  const muted = theme.props('muted');
  const accent = theme.color('accent');
  const frame = { theme, columns: p.dialog?.columns ?? 80, rows: p.dialog?.rows ?? 24, bare: true };
  let body: ReactNode;
  if (mode === 'name')
    body = h(NameView, {
      ...frame,
      initial: profile?.name ?? '',
      verb: 'save',
      onDone: (name) => {
        p.profile.update({ name });
        setMode('menu');
      },
      onSkip: () => setMode('menu'),
    });
  else if (mode === 'goals')
    body = h(GoalsView, {
      ...frame,
      initial: profile?.goals ?? [],
      verb: 'save',
      onDone: (goals) => {
        p.profile.update({ goals });
        setMode('menu');
      },
      onSkip: () => setMode('menu'),
    });
  else if (mode === 'delete')
    body = h(
      Box,
      { flexDirection: 'column' },
      h(Text, null, 'Delete your profile?'),
      h(Text, muted, 'The name and goals are removed from this computer. Nothing else changes.'),
      h(Box, { height: 1 }),
      h(Hints, { hint: 'Y delete · N keep', theme }),
    );
  else
    body = h(
      Box,
      { flexDirection: 'column' },
      ...rows.map((r, i) =>
        h(
          Box,
          { key: r.id, justifyContent: 'space-between' },
          h(
            Text,
            i === at ? { bold: true, ...(accent ? { color: accent } : {}) } : {},
            `${i === at ? theme.symbols.prompt : ' '} ${r.label}`,
          ),
          h(Text, { ...muted, wrap: 'truncate-end' }, ` ${r.detail}`),
        ),
      ),
      h(Box, { height: 1 }),
      h(Hints, { hint: '↑↓ move · Enter change · Esc close', theme }),
    );

  if (p.dialog)
    return h(Dialog, { title: 'Your profile', theme, ...p.dialog, size: 'small' }, body);
  return h(
    Box,
    { flexDirection: 'column', paddingLeft: theme.space.indent, marginTop: 1 },
    h(Text, { bold: true }, 'Your profile'),
    h(Box, { height: 1 }),
    body,
  );
}
