// First run: three steps, each with the orb on the right. Nothing is stored except `remy.onboarded`;
// keys never go through the browser, so step 1 names the terminal command that stores one, and step
// 2 suggests apps while the server decides which are actually connected.
import { type ReactNode, useEffect, useId, useState } from 'react';
import type { ConnectedApp } from '../../api/index.tsx';
import { useApi } from '../../api/index.tsx';
import { AsciiMark, DotField } from '../../components/AsciiMark.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Logo } from '../../components/Logo.tsx';
import { Orb } from '../../components/Orb.tsx';
import { CopyCommand } from '../../components/CopyCommand.tsx';
import { buttonPrimary, buttonQuiet } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
import { setSetting } from '../../settings.ts';
import { hasToken } from './useFirstRun.ts';

const STEPS = ['Pick a model', 'Connect your apps', 'Ask for something'];
const LABELS = [
  [{ label: 'you' }, { label: 'memory' }],
  [{ label: 'files' }, { label: 'calendar' }],
  [{ label: 'you' }, { label: 'web' }],
];
const CAPTION: [string, string][] = [
  ["I'm your assistant.", 'I ask before I send anything as you or spend money. Always.'],
  [
    'You stay in charge.',
    'Each app gets only what you allow, and you can take it back in one click.',
  ],
  ['Ready when you are.', 'Ask for anything you would do on a computer.'],
];

const finish = () => setSetting('onboarded', true);

function Trace({ at }: { at: number }) {
  return (
    <ol aria-label="Setup steps" className="m-0 p-0">
      {STEPS.map((label, i) => {
        const done = i < at;
        const current = i === at;
        return (
          <li
            key={label}
            aria-current={current ? 'step' : undefined}
            className={`relative flex list-none items-center gap-3 font-mono text-[13px] ${i < STEPS.length - 1 ? 'pb-6 before:absolute before:top-4 before:bottom-0 before:left-[7.5px] before:w-px before:bg-stone' : ''} ${current ? 'text-text' : 'text-muted'}`}
          >
            <span
              aria-hidden="true"
              className={`relative z-10 grid size-4 place-items-center rounded-full border text-[9px] leading-none ${current ? 'border-signal bg-signal text-signal-ink' : 'border-edge-hi bg-bg'}`}
            >
              {done ? <Icon name="check" size={9} /> : i + 1}
            </span>
            {label}
            {done && <span className="sr-only"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Frame({
  at,
  title,
  lead,
  children,
}: {
  at: number;
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const [head, rest] = CAPTION[at] as [string, string];
  return (
    <div className="relative overflow-hidden">
      <DotField className="absolute inset-0 h-full w-full [mask-image:radial-gradient(ellipse_52%_52%_at_50%_46%,#000_14%,transparent_76%)] [-webkit-mask-image:radial-gradient(ellipse_52%_52%_at_50%_46%,#000_14%,transparent_76%)]" />
      <div className="relative mx-auto grid min-h-screen max-w-[1440px] gap-10 px-5 pt-10 pb-12 sm:px-14 lg:grid-cols-[minmax(0,588px)_minmax(0,1fr)] lg:gap-[120px]">
        <div className="min-w-0">
          <a href="#/" aria-label="Remy, home" className="block w-[min(340px,100%)]">
            <AsciiMark fallback={<Logo size="min(8px, 2.5vw)" />} />
          </a>
          <div className="mt-9">
            <Trace at={at} />
          </div>
          <h1 className="mt-10 mb-0 text-[34px] leading-[1.15] font-medium tracking-tight">
            {title}
          </h1>
          <p className="mt-3 mb-0 max-w-[510px] text-[16px] leading-relaxed text-muted">{lead}</p>
          <div className="mt-8">{children}</div>
        </div>
        <div className="hidden flex-col items-center justify-center lg:flex">
          <Orb satellites={LABELS[at] ?? []} />
          <p className="font-mono mt-4 mb-0 text-center text-[12px] leading-relaxed text-muted">
            <span className="text-text">{head}</span>
            <br />
            <span className="inline-block max-w-[320px]">{rest}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

const WAYS = [
  {
    id: 'own',
    title: 'Use my own key',
    text: 'OpenRouter, OpenAI, Groq, or any compatible service. Pay the provider directly.',
  },
  {
    id: 'local',
    title: 'Run a model on this machine',
    text: 'Ollama. Free and private. Slower on a light laptop.',
  },
  {
    id: 'server',
    title: 'Use my home server',
    text: 'Remy runs there and you reach it from any device.',
  },
] as const;

function StepOne() {
  const api = useApi();
  const name = useId();
  const [way, setWay] = useState<(typeof WAYS)[number]['id']>('own');
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const test = async () => {
    try {
      const { detail } = await api.testModels();
      setNote({ text: detail, ok: true });
    } catch (e) {
      setNote({ text: describeError(e, 'The check did not run. Try again.'), ok: false });
    }
  };
  return (
    <Frame
      at={0}
      title="Hi, I'm Remy."
      lead="First, pick the model I think with. You can change it any time. Your key is the password that lets me use it, and it goes in the Keychain on this computer."
    >
      <fieldset className="m-0 grid gap-2.5 border-0 p-0">
        <legend className="sr-only">How Remy thinks</legend>
        {WAYS.map((w) => (
          <label
            key={w.id}
            className="flex cursor-pointer items-start gap-4 rounded-[10px] border border-edge bg-surface px-5 py-4 has-checked:border-text has-checked:bg-raise has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-text"
          >
            <input
              type="radio"
              name={name}
              value={w.id}
              checked={way === w.id}
              onChange={() => setWay(w.id)}
              className="mt-1.5 size-4 shrink-0 accent-signal"
            />
            <span>
              <span className="block text-[16px] font-medium">{w.title}</span>
              <span className="mt-1 block text-[14px] leading-snug text-muted">{w.text}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {way === 'own' && (
        <div className="mt-7">
          <p className="font-mono m-0 text-[12px] text-muted">Your OpenRouter key</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="font-mono rounded-[6px] border border-edge bg-raise px-3 py-2 text-[13px]">
              remy login
            </code>
            <CopyCommand command="remy login" title="sign in" what="run" label="Copy" />
          </div>
          <p className="mt-2 mb-0 text-[13px] text-muted">
            Run that in your terminal. The key goes in the Keychain on this computer, and this page
            never sees it.
          </p>
        </div>
      )}
      {way === 'local' && (
        <p className="mt-7 mb-0 text-[14px] text-muted">
          Remy looks for Ollama on this machine and picks a model it finds.
        </p>
      )}
      {way === 'server' && (
        <p className="mt-7 mb-0 text-[14px] text-muted">
          Sign in to your server with its address and token.{' '}
          <a className="text-text underline" href="#/sign-in">
            Sign in to a home server
          </a>
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <a className={`${buttonPrimary} px-5 py-3 no-underline`} href="#/welcome/2">
          Continue
        </a>
        <button type="button" className={`${buttonQuiet} px-5 py-3`} onClick={test}>
          Check the model
        </button>
      </div>
      {note && (
        <p
          role="status"
          className="mt-3 mb-0 flex items-start gap-2 text-[13px] leading-snug text-text"
        >
          <Icon
            name={note.ok ? 'check' : 'close'}
            className={`mt-0.5 shrink-0 ${note.ok ? 'text-signal' : 'text-muted'}`}
          />
          <span className="min-w-0">{note.text}</span>
        </p>
      )}
      <SkipSetup />
    </Frame>
  );
}

// Suggestions, not claims: whether one is connected comes from the server, never from this list.
const APPS = [
  { name: 'Gmail', text: 'Read, draft, send with approval', action: 'Connect Gmail' },
  { name: 'Google Calendar', text: 'See your day, hold time', action: 'Connect Calendar' },
  { name: 'Notion', text: 'Read your pages', action: 'Connect Notion' },
];

function StepTwo() {
  const api = useApi();
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  useEffect(() => {
    // Onboarding is reachable without a session, and a 401 here would send the person to sign-in
    // mid-setup. So ask only when there is a session to ask with; otherwise claim nothing.
    if (!hasToken()) return;
    let live = true;
    api.connections().then(
      (d) => {
        if (live) setApps(d.apps);
      },
      () => {
        // A server that cannot answer is not evidence that anything is connected.
        if (live) setApps([]);
      },
    );
    return () => {
      live = false;
    };
  }, [api]);
  const state = (name: string) =>
    apps?.find((a) => a.name.toLowerCase() === name.toLowerCase())?.status;
  return (
    <Frame
      at={1}
      title="Connect the apps you use."
      lead="Start with what you use every day. You can add or remove any of these later. Skip this and Remy still works with files and the web."
    >
      <ul className="m-0 grid gap-2.5 p-0">
        {APPS.map((a) => (
          <li
            key={a.name}
            className="flex list-none flex-wrap items-center gap-x-4 gap-y-3 rounded-[10px] border border-edge bg-surface px-4 py-4"
          >
            <span
              aria-hidden="true"
              className="font-mono grid size-[26px] shrink-0 place-items-center rounded-md border border-edge-hi text-[12px] text-muted"
            >
              {a.name[0]}
            </span>
            <span className="min-w-0 flex-1 basis-40">
              <span className="block text-[16px] font-medium">{a.name}</span>
              <span className="mt-0.5 block text-[14px] text-muted">{a.text}</span>
            </span>
            {state(a.name) === 'connected' ? (
              <span className="font-mono text-[13px] text-muted">Connected</span>
            ) : state(a.name) === 'needs_signin' ? (
              <a className={`${buttonQuiet} px-4 py-2.5 no-underline`} href="#/connections">
                Needs a sign-in
              </a>
            ) : (
              <a className={`${buttonQuiet} px-4 py-2.5 no-underline`} href="#/connections/add">
                {a.action}
              </a>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap gap-3">
        <a className={`${buttonPrimary} px-5 py-3 no-underline`} href="#/welcome/3">
          Next: ask for something
        </a>
        <a className={`${buttonQuiet} px-5 py-3 no-underline`} href="#/welcome/3">
          Skip for now
        </a>
      </div>
      <SkipSetup />
    </Frame>
  );
}

const TRY = [
  'Find three flights to Lisbon under £350',
  'What do I still owe Dana before the audit?',
  'Tidy my Downloads folder, show me before moving anything',
];

function StepThree() {
  const api = useApi();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const start = async () => {
    const prompt = text.trim();
    if (!prompt) return;
    try {
      const { taskId } = await api.startTask(prompt);
      finish();
      window.location.hash = `#/tasks/${encodeURIComponent(taskId)}`;
    } catch (e) {
      setError(describeError(e, 'Remy could not start that. Try again.'));
    }
  };
  return (
    <Frame
      at={2}
      title="What do you need done?"
      lead="Anything you would do on a computer. Start small. Remy shows its work and asks before it sends or spends."
    >
      <div className="flex gap-3 rounded-[14px] border border-edge-hi bg-surface p-3.5 focus-within:border-text">
        <textarea
          aria-label="What you need done"
          placeholder="Summarise this week's emails from Dana"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 resize-none border-0 bg-transparent p-1.5 text-[17px] text-text outline-none placeholder:text-muted"
        />
        <button
          type="button"
          className={`${buttonPrimary} h-fit px-5 py-3`}
          disabled={!text.trim()}
          onClick={start}
        >
          Ask Remy
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 mb-0 text-[13px] text-muted">
          {error}
        </p>
      )}
      <h2 className="font-mono mt-6 mb-3 text-[12px] font-normal text-muted">
        Or try one of these
      </h2>
      <ul className="m-0 grid gap-2.5 p-0">
        {TRY.map((t) => (
          <li key={t} className="list-none">
            <button
              type="button"
              onClick={() => setText(t)}
              className="w-full cursor-pointer rounded-md border border-edge bg-surface px-3.5 py-3 text-left text-[15px] text-text hover:bg-raise"
            >
              {t}
            </button>
          </li>
        ))}
      </ul>
      <SkipSetup />
    </Frame>
  );
}

function SkipSetup() {
  return (
    <p className="mt-8 mb-0 text-[13px]">
      <button
        type="button"
        onClick={() => {
          finish();
          window.location.hash = '#/';
        }}
        className="cursor-pointer border-0 bg-transparent p-0 text-[13px] text-muted underline hover:text-text"
      >
        Skip setup and open Remy
      </button>
    </p>
  );
}

export function Welcome({ step = '1' }: { step?: string }) {
  if (step === '2') return <StepTwo />;
  if (step === '3') return <StepThree />;
  return <StepOne />;
}
