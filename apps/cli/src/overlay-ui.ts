// The login, model and palette panels, shared by the classic and full-screen chat.
import { createElement as h, type ReactElement } from 'react';
import type { Chat, ChatState, ModelChoice } from './chat.ts';
import { COMMANDS } from './commands.ts';
import { LoginFlow } from './login-ui.ts';
import { Picker, type PickItem } from './picker.ts';
import type { Theme } from './theme.ts';

const choiceId = (c: ModelChoice) => `${c.provider}\t${c.model}`;

/** The login, model and palette panels. Each takes over the prompt until it closes. */
export function Overlay(p: {
  chat: Chat;
  state: ChatState;
  theme: Theme;
  onTranscript: () => void;
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
    return h(Picker, {
      title: 'Switch model',
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
