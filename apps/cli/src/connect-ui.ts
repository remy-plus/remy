// /connect in the chat: pick an app or service, answer only what it needs, say yes to running
// code, and (for a browser sign-in) wait for the browser. Same steps in the full-screen dialog and
// the minimal screen; `dialog` switches the frame, like the login flow.
import { Box, Text, useInput } from 'ink';
import { createElement as h, type ReactElement, useEffect, useRef, useState } from 'react';
import type { ConnectPlan } from './connect-plan.ts';
import type { SignInHooks } from './connections-view.ts';
import { Hints } from './hints.ts';
import { Dialog, dialogSize } from './screen/dialog.ts';
import {
  type DialogItem,
  DialogList,
  type DialogState,
  dialogKey,
  initialDialogState,
} from './screen/dialog-list.ts';
import { moveSelection } from './session-picker.ts';
import type { Theme } from './theme.ts';

export interface CatalogChoice {
  id: string;
  label: string;
  blurb: string;
  /** The question to ask when the entry needs a folder. */
  folderLabel?: string;
}

/** What the chat needs to add a connection. `prepare` throws an Error whose message is a sentence for the user. */
export interface ConnectFlowApi {
  choices(): CatalogChoice[];
  prepare(
    a: { entryId: string; folder?: string } | { custom: { input: string; name: string } },
  ): ConnectPlan;
  suggestName(input: string): string;
  /** Saves and starts (or signs in). Resolves with the line for the transcript. */
  add(plan: ConnectPlan, values: Record<string, string>, hooks: SignInHooks): Promise<string>;
  /** A folder to offer as the default. */
  defaultFolder(): string;
}

const CUSTOM = '#custom';

type Step =
  | { kind: 'pick' }
  | { kind: 'folder'; entry: CatalogChoice }
  | { kind: 'address' }
  | { kind: 'name'; address: string }
  | { kind: 'secret'; plan: ConnectPlan; at: number; values: Record<string, string> }
  | { kind: 'confirm'; plan: ConnectPlan; values: Record<string, string> }
  | { kind: 'working'; plan: ConnectPlan };

export function ConnectFlow(p: {
  api: ConnectFlowApi;
  theme: Theme;
  dialog?: { columns: number; rows: number };
  onDone: () => void;
  onCancel: () => void;
}): ReactElement {
  const { theme, api } = p;
  const choices = api.choices();
  const [step, setStep] = useState<Step>({ kind: 'pick' });
  const [at, setAt] = useState(0);
  const [text, setText] = useState('');
  const [note, setNote] = useState<string | undefined>();
  const [dlg, setDlg] = useState<DialogState>(initialDialogState);
  const [yes, setYes] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => abort.current?.abort(), []);

  const items: DialogItem[] = [
    ...choices.map((c) => ({ id: c.id, title: c.label, detail: c.blurb })),
    { id: CUSTOM, title: 'Custom server', detail: 'a web address or a command you have' },
  ];

  const fail = (e: unknown) => setNote(e instanceof Error ? e.message : String(e));

  const afterPlan = (plan: ConnectPlan, values: Record<string, string> = {}) => {
    setNote(undefined);
    setText('');
    if (plan.secrets.length) return setStep({ kind: 'secret', plan, at: 0, values });
    if (plan.command) {
      setYes(false);
      return setStep({ kind: 'confirm', plan, values });
    }
    return run(plan, values);
  };

  const run = (plan: ConnectPlan, values: Record<string, string>) => {
    const ac = new AbortController();
    abort.current = ac;
    setStep({ kind: 'working', plan });
    api
      .add(plan, values, { signal: ac.signal })
      .catch(() => {})
      .finally(() => {
        if (abort.current === ac) abort.current = undefined;
        p.onDone();
      });
  };

  const choose = (id: string) => {
    setNote(undefined);
    setText('');
    if (id === CUSTOM) return setStep({ kind: 'address' });
    const entry = choices.find((c) => c.id === id);
    if (!entry) return;
    if (entry.folderLabel) {
      setText(api.defaultFolder());
      return setStep({ kind: 'folder', entry });
    }
    try {
      afterPlan(api.prepare({ entryId: entry.id }));
    } catch (e) {
      fail(e);
    }
  };

  const submit = (value: string) => {
    try {
      if (step.kind === 'folder') {
        afterPlan(api.prepare({ entryId: step.entry.id, folder: value }));
      } else if (step.kind === 'address') {
        if (!value) return;
        setNote(undefined);
        setText(api.suggestName(value));
        setStep({ kind: 'name', address: value });
      } else if (step.kind === 'name') {
        afterPlan(api.prepare({ custom: { input: step.address, name: value } }));
      } else if (step.kind === 'secret') {
        const s = step.plan.secrets[step.at];
        if (!s || !value) return;
        const values = { ...step.values, [s.key]: value };
        setText('');
        if (step.at + 1 < step.plan.secrets.length)
          return setStep({ ...step, at: step.at + 1, values });
        if (step.plan.command) {
          setYes(false);
          return setStep({ kind: 'confirm', plan: step.plan, values });
        }
        run(step.plan, values);
      }
    } catch (e) {
      fail(e);
    }
  };

  useInput((input, k) => {
    if (k.ctrl && input === 'c') return p.onCancel();
    if (step.kind === 'working') {
      // Esc stops a browser sign-in that is still waiting.
      if (k.escape) abort.current?.abort();
      return;
    }
    if (step.kind === 'pick') {
      if (p.dialog) {
        const r = dialogKey(dlg, input, k, { items });
        setDlg(r.state);
        if (r.action?.type === 'close') return p.onCancel();
        if (r.action?.type === 'pick') choose(r.action.item.id);
        return;
      }
      if (k.escape) return p.onCancel();
      if (k.upArrow) return setAt((i) => moveSelection(i, -1, items.length));
      if (k.downArrow) return setAt((i) => moveSelection(i, 1, items.length));
      if (k.return) choose((items[at] as DialogItem).id);
      return;
    }
    if (k.escape) {
      setNote(undefined);
      setText('');
      return step.kind === 'name' || step.kind === 'confirm' || step.kind === 'secret'
        ? setStep({ kind: 'pick' })
        : step.kind === 'address' || step.kind === 'folder'
          ? setStep({ kind: 'pick' })
          : p.onCancel();
    }
    if (step.kind === 'confirm') {
      if (k.upArrow || k.downArrow) return setYes((v) => !v);
      if (k.return) return yes ? run(step.plan, step.values) : setStep({ kind: 'pick' });
      return;
    }
    if (k.return) return submit(text.trim());
    if (k.backspace || k.delete) return setText((t) => t.slice(0, -1));
    if (k.ctrl || k.meta || k.upArrow || k.downArrow || k.tab || !input) return;
    const clean = input
      .replace(/[\r\n]+/g, '')
      .replaceAll('\u001b[200~', '')
      .replaceAll('\u001b[201~', '');
    if (/[\r\n]/.test(input) && clean) return submit((text + clean).trim());
    setText((t) => t + clean);
  });

  const muted = theme.props('muted');
  const accent = theme.color('accent');
  const accentProps = accent ? { color: accent } : {};
  const errorColor = theme.color('error');
  const field = (masked: boolean) =>
    h(
      Box,
      null,
      h(Text, muted, `${theme.symbols.prompt} `),
      h(Text, null, masked ? '•'.repeat(Math.min(text.length, 48)) : text),
      h(Text, accentProps, theme.symbols.cursor),
    );
  const hint = (s: string) =>
    h(Box, { key: 'hint', marginTop: theme.space.turn }, h(Hints, { hint: s, theme }));

  const rows: ReactElement[] = [];
  if (step.kind === 'pick') {
    if (p.dialog) {
      const g = dialogSize(p.dialog.columns, p.dialog.rows, 'medium');
      rows.push(
        h(DialogList, {
          key: 'list',
          items,
          state: dlg,
          theme,
          width: g.inner,
          rows: Math.min(g.listRows, items.length + 1),
          placeholder: 'Search apps and services',
        }),
      );
    } else {
      for (const [i, c] of items.entries()) {
        const on = i === at;
        rows.push(
          h(
            Box,
            { key: c.id },
            h(
              Box,
              { width: theme.space.lead, flexShrink: 0 },
              h(Text, on ? accentProps : muted, on ? theme.symbols.prompt : ' '),
            ),
            h(Text, on ? { bold: true } : {}, c.title),
            h(Text, muted, `  ${c.detail ?? ''}`),
          ),
        );
      }
      rows.push(hint('↑↓ choose · Enter select · Esc cancel'));
    }
  } else if (step.kind === 'folder') {
    rows.push(
      h(Text, { key: 'q' }, `${step.entry.folderLabel}. Remy can reach nothing outside it.`),
      h(Box, { key: 'f' }, field(false)),
      hint('Enter continue · Esc back'),
    );
  } else if (step.kind === 'address') {
    rows.push(
      h(Text, { key: 'q' }, 'Web address (https://...) or the command to run'),
      h(Box, { key: 'f' }, field(false)),
      hint('Enter continue · Esc back'),
    );
  } else if (step.kind === 'name') {
    rows.push(
      h(Text, { key: 'q' }, 'Name for it'),
      h(Box, { key: 'f' }, field(false)),
      hint('Enter continue · Esc back'),
    );
  } else if (step.kind === 'secret') {
    const s = step.plan.secrets[step.at];
    rows.push(
      h(Text, { key: 'q' }, `${s?.label ?? 'Token'}. It is hidden as you type.`),
      ...(s ? [h(Text, { key: 'w', ...muted }, s.where)] : []),
      h(Box, { key: 'f' }, field(true)),
      hint('Enter continue · Esc back'),
    );
  } else if (step.kind === 'confirm') {
    rows.push(
      h(
        Text,
        { key: 'q' },
        'Remy will run this on your computer, with your permissions, each time it starts:',
      ),
      h(Text, { key: 'c', ...accentProps }, `  ${step.plan.command}`),
      ...[
        { on: false, label: 'No, do not add it' },
        { on: true, label: 'Yes, add it' },
      ].map((o) =>
        h(
          Box,
          { key: o.label },
          h(
            Box,
            { width: theme.space.lead, flexShrink: 0 },
            h(Text, yes === o.on ? accentProps : muted, yes === o.on ? theme.symbols.prompt : ' '),
          ),
          h(Text, yes === o.on ? { bold: true } : {}, o.label),
        ),
      ),
      hint('↑↓ choose · Enter confirm · Esc back'),
    );
  } else {
    rows.push(
      h(
        Text,
        { key: 'w', ...muted },
        step.plan.oauth ? 'Waiting for the browser. Esc cancels.' : `Adding ${step.plan.name}.`,
      ),
    );
  }
  if (note) rows.push(h(Text, { key: 'note', ...(errorColor ? { color: errorColor } : {}) }, note));

  if (p.dialog)
    return h(
      Dialog,
      { title: 'Connect an app or service', theme, ...p.dialog, size: 'medium' },
      ...rows,
    );
  return h(
    Box,
    { flexDirection: 'column', paddingLeft: theme.space.indent, marginTop: 1 },
    h(Text, { key: 'title', bold: true }, 'Connect an app or service'),
    ...rows,
  );
}
