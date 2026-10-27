// `remy login`: pick a provider, paste the key (masked), optionally name a default model.
import { Box, render, Text, useInput } from 'ink';
import { createElement as h, type ReactElement, useState } from 'react';
import { moveSelection } from './session-picker.ts';
import type { Theme } from './theme.ts';

export interface ProviderChoice {
  id: string;
  label: string;
  /** False for local providers such as Ollama. */
  needsKey: boolean;
  /** True for the custom endpoint: asks for its base URL first. */
  needsBaseUrl?: boolean;
  /** The model used when none is named; shown under the model question. */
  exampleModel?: string;
  /** Where to get a key, shown under the key question. */
  keyUrl?: string;
}

export interface LoginEntry {
  provider: string;
  key: string;
  baseUrl?: string;
  model?: string;
}

export type LoginResult = { ok: true; message: string } | { ok: false; message: string };

type Step = 'provider' | 'baseUrl' | 'key' | 'model' | 'checking' | 'done';

export function LoginFlow(p: {
  providers: ProviderChoice[];
  theme: Theme;
  /** A line under the title, for the first run. */
  intro?: string;
  /** Verifies and saves. `ok: false` returns to the key question with the message. */
  onSubmit: (entry: LoginEntry) => Promise<LoginResult>;
  onDone: () => void;
  onCancel: () => void;
}): ReactElement {
  const { theme, providers } = p;
  const [step, setStep] = useState<Step>('provider');
  const [at, setAt] = useState(0);
  const [text, setText] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [key, setKey] = useState('');
  const [note, setNote] = useState<LoginResult | undefined>();
  const choice = providers[at] as ProviderChoice;

  const submit = async (model: string, k = key, url = baseUrl) => {
    setStep('checking');
    const result = await p.onSubmit({
      provider: choice.id,
      key: k,
      ...(url && { baseUrl: url }),
      ...(model && { model }),
    });
    setNote(result);
    if (result.ok) {
      setStep('done');
      setTimeout(p.onDone, 0);
    } else {
      setText('');
      setStep(choice.needsKey ? 'key' : 'provider');
    }
  };

  const next = (value: string) => {
    if (step === 'baseUrl') {
      if (!value) return;
      setBaseUrl(value);
      setText('');
      setStep(choice.needsKey ? 'key' : 'model');
    } else if (step === 'key') {
      if (!value) return;
      setKey(value);
      setText('');
      setStep('model');
    } else if (step === 'model') void submit(value);
  };

  useInput((input, k) => {
    if (step === 'checking' || step === 'done') return;
    if (k.escape || (k.ctrl && input === 'c')) return p.onCancel();
    if (step === 'provider') {
      if (k.upArrow) return setAt((i) => moveSelection(i, -1, providers.length));
      if (k.downArrow) return setAt((i) => moveSelection(i, 1, providers.length));
      if (k.return) {
        setNote(undefined);
        setText('');
        setKey('');
        setBaseUrl('');
        if (choice.needsBaseUrl) setStep('baseUrl');
        else setStep(choice.needsKey ? 'key' : 'model');
      }
      return;
    }
    if (k.return) return next(text.trim());
    if (k.backspace || k.delete) return setText((t) => t.slice(0, -1));
    if (k.ctrl || k.meta || k.upArrow || k.downArrow || k.tab) return;
    if (!input) return;
    // A paste can arrive in one chunk, newline included.
    const clean = input
      .replace(/[\r\n]+/g, '')
      .replaceAll('\u001b[200~', '')
      .replaceAll('\u001b[201~', '');
    const entered = (text + clean).trim();
    if (/[\r\n]/.test(input) && clean) return next(entered);
    setText((t) => t + clean);
  });

  const mutedColor = theme.color('muted');
  const muted = mutedColor ? { color: mutedColor } : { dimColor: true };
  const accent = theme.color('accent');
  const accentProps = accent ? { color: accent } : {};
  const errorColor = theme.color('error');
  const cursor = h(Text, accentProps, theme.symbols.cursor);
  const field = (masked: boolean) =>
    h(
      Box,
      null,
      h(Text, muted, `${theme.symbols.prompt} `),
      h(Text, null, masked ? '•'.repeat(Math.min(text.length, 48)) : text),
      cursor,
    );

  const rows: ReactElement[] = [
    h(Text, { key: 'title', bold: true }, 'Connect a model provider'),
    ...(p.intro && step === 'provider' ? [h(Text, { key: 'intro', ...muted }, p.intro)] : []),
  ];
  if (step === 'provider') {
    for (const [i, c] of providers.entries()) {
      const on = i === at;
      rows.push(
        h(
          Box,
          { key: c.id },
          h(
            Box,
            { width: 2, flexShrink: 0 },
            h(Text, on ? accentProps : muted, on ? theme.symbols.prompt : ' '),
          ),
          h(Text, on ? { bold: true } : {}, c.label),
        ),
      );
    }
    rows.push(h(Text, { key: 'hint', ...muted }, '↑↓ choose · Enter select · Esc cancel'));
  } else {
    rows.push(h(Text, { key: 'who', ...muted }, choice.label));
    if (step === 'baseUrl')
      rows.push(
        h(
          Text,
          { key: 'q' },
          'Base URL of the OpenAI-compatible API (for example https://host/v1)',
        ),
        h(Box, { key: 'f' }, field(false)),
      );
    else if (step === 'key')
      rows.push(
        h(Text, { key: 'q' }, 'Paste your API key. It is hidden as you type.'),
        ...(choice.keyUrl ? [h(Text, { key: 'u', ...muted }, `Get one at ${choice.keyUrl}`)] : []),
        h(Box, { key: 'f' }, field(true)),
      );
    else if (step === 'model')
      rows.push(
        h(
          Text,
          { key: 'q' },
          choice.exampleModel
            ? `Model. Enter to use ${choice.exampleModel}, or type another id.`
            : 'Model id to use. Enter to choose from a list later.',
        ),
        h(Box, { key: 'f' }, field(false)),
      );
    else if (step === 'checking') rows.push(h(Text, { key: 'q', ...muted }, 'Checking the key.'));
    if (step !== 'checking' && step !== 'done')
      rows.push(h(Text, { key: 'hint', ...muted }, 'Enter continue · Esc cancel'));
  }
  if (note)
    rows.push(
      h(
        Text,
        { key: 'note', ...(!note.ok && errorColor ? { color: errorColor } : accentProps) },
        note.message,
      ),
    );
  return h(
    Box,
    { flexDirection: 'column', paddingLeft: theme.space.indent, marginTop: 1 },
    ...rows,
  );
}

/** Runs the picker on the real terminal. Resolves true once a login is saved, false on cancel. */
export async function runLogin(o: {
  providers: ProviderChoice[];
  theme: Theme;
  onSubmit: (entry: LoginEntry) => Promise<LoginResult>;
}): Promise<boolean> {
  let saved = false;
  const app = render(
    h(LoginFlow, {
      providers: o.providers,
      theme: o.theme,
      onSubmit: async (entry) => {
        const r = await o.onSubmit(entry);
        if (r.ok) saved = true;
        return r;
      },
      onDone: () => app.unmount(),
      onCancel: () => app.unmount(),
    }),
    { exitOnCtrlC: false, patchConsole: false },
  );
  await app.waitUntilExit();
  return saved;
}
