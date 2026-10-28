// The login, model and palette panels, shared by the classic and full-screen chat.
import { createElement as h, type ReactElement } from 'react';
import type { Chat, ChatState, ModelChoice } from './chat.ts';
import { COMMANDS } from './commands.ts';
import { ConnectFlow } from './connect-ui.ts';
import { useConnections } from './connections-flow.ts';
import type { ConnectionsApi } from './connections-view.ts';
import { defaultModelFor } from './login.ts';
import { LoginFlow } from './login-ui.ts';
import { cheapChoice } from './onboarding.ts';
import { Picker, type PickItem } from './picker.ts';
import type { ThemeChoice } from './prefs.ts';
import type { ProfileStore } from './profile.ts';
import { ProfilePanel } from './profile-ui.ts';
import type { Theme } from './theme.ts';

/** The rows of the theme picker; the one in use is marked. */
export const themeItems = (current: ThemeChoice): PickItem[] =>
  [
    { id: 'auto', title: 'Auto', detail: 'follows your terminal' },
    { id: 'light', title: 'Light', detail: 'for a light terminal' },
    { id: 'dark', title: 'Dark', detail: 'for a dark terminal' },
  ].map((i) => ({ ...i, detail: `${i.detail}${i.id === current ? ' · in use' : ''}` }));

const choiceId = (c: ModelChoice) => `${c.provider}\t${c.model}`;

function ConnectionsPicker(p: { api: ConnectionsApi; theme: Theme; onClose: () => void }) {
  const view = useConnections(p.api, p.onClose);
  return h(Picker, {
    key: view.title,
    title: view.title,
    items: view.items,
    theme: p.theme,
    max: 8,
    onPick: (item) => view.pick(item.id),
    onCancel: view.back,
  });
}

/** The login, model and palette panels. Each takes over the prompt until it closes. */
export function Overlay(p: {
  chat: Chat;
  state: ChatState;
  theme: Theme;
  onTranscript: () => void;
  profile?: ProfileStore;
  /** The tour is on: the model list highlights a cheap default. */
  touring?: boolean;
}): ReactElement | null {
  const { chat, state, theme } = p;
  const close = () => chat.closeOverlay();
  if (state.overlay === 'login')
    return h(LoginFlow, {
      providers: chat.providers(),
      theme,
      ...(!state.model && {
        intro: 'Remy needs a model to think with. Pick a provider; the key stays on this computer.',
      }),
      onSubmit: (entry) => chat.saveLogin(entry),
      onDone: () => chat.closeOverlay('login'),
      onCancel: () => chat.closeOverlay('login'),
    });
  if (state.overlay === 'model') {
    const choices = chat.models();
    const items: PickItem[] = [
      ...choices.map((c) => ({
        id: choiceId(c),
        title: c.model,
        detail: `${c.provider} · ${c.detail}${c.model === state.model ? ' · in use' : ''}`,
      })),
      { id: '#login', title: 'Connect another provider', detail: '/login' },
    ];
    const provider = choices.find((c) => c.model === state.model)?.provider ?? choices[0]?.provider;
    const cheap = p.touring ? cheapChoice(choices, state.model, defaultModelFor) : undefined;
    return h(Picker, {
      title: p.touring ? 'Pick a model' : 'Switch model',
      ...(cheap && { initialId: choiceId(cheap) }),
      items,
      theme,
      empty: 'No saved logins. Run /login to connect a provider.',
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
      onCancel: close,
    });
  }
  if (state.overlay === 'connect')
    return h(ConnectFlow, {
      api: chat.addConnection(),
      theme,
      onDone: () => chat.closeOverlay('connect'),
      onCancel: () => chat.closeOverlay('connect'),
    });
  if (state.overlay === 'connections')
    return h(ConnectionsPicker, {
      api: chat.connections(),
      theme,
      onClose: () => chat.closeOverlay('connections'),
    });
  if (state.overlay === 'profile' && p.profile)
    return h(ProfilePanel, {
      profile: p.profile,
      theme,
      onClose: () => chat.closeOverlay('profile'),
    });
  if (state.overlay === 'theme')
    return h(Picker, {
      title: 'Theme',
      items: themeItems(state.theme),
      theme,
      max: 3,
      onPick: (item) => chat.setTheme(item.id as ThemeChoice),
      onCancel: close,
    });
  const items: PickItem[] = [
    ...COMMANDS.map((c) => ({
      id: c.name,
      title: c.summary,
      detail: [`/${c.name}`, c.keys].filter(Boolean).join(' · '),
    })),
    { id: '#transcript', title: 'Read the whole conversation', detail: 'Ctrl+O' },
  ];
  return h(Picker, {
    title: 'Commands',
    items,
    theme,
    max: items.length,
    onPick: (item) => {
      if (item.id === '#transcript') {
        chat.closeOverlay();
        return p.onTranscript();
      }
      void chat.runCommand(item.id);
    },
    onCancel: close,
  });
}
