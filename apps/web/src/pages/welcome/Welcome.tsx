// First run: three steps, each with the orb on the right. Nothing is stored except `remy.onboarded`;
// keys never go through the browser, and the list of apps in step 2 is sample data for now.
import { type ReactNode, useId, useState } from 'react';
import { useApi } from '../../api/index.tsx';
import { AsciiMark, DotField } from '../../components/AsciiMark.tsx';
import { Logo } from '../../components/Logo.tsx';
import { Orb } from '../../components/Orb.tsx';
import { buttonPrimary, buttonQuiet, field } from '../../components/ui.ts';
import { setSetting } from '../../settings.ts';

const STEPS = ['Choose how Remy thinks', 'Connect what it can reach', 'Give it a first task'];
const LABELS = [
  [{ label: 'you' }, { label: 'memory' }],
  [{ label: 'files' }, { label: 'calendar' }],
  [{ label: 'you' }, { label: 'web' }],
];
const CAPTION: [string, string][] = [
  [
    'Your assistant, anywhere.',
    'Remy asks before it sends anything as you or spends money. Always.',
  ],
  [
    'You stay in charge.',
    'Each app gets only the access you choose, and you can take it back in one click.',
  ],
  ['Ready when you are.', 'Your assistant, anywhere.'],
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
              {done ? '✓' : i + 1}
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
  const [key, setKey] = useState('');
  const [note, setNote] = useState('');
  const test = async () => {
    setKey(''); // the browser never keeps a key
    try {
      setNote((await api.testModels()).detail);
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'The test did not run.');
    }
  };
  return (
    <Frame
      at={0}
      title="Choose how Remy thinks."
      lead="Remy works with the model you pick. You can change it any time, and your key stays on your machine."
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
              className="mt-1.5 size-4 shrink-0 accent-[#a8c49a]"
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
          <label htmlFor={`${name}-key`} className="font-mono block text-[12px] text-muted">
            API key for OpenRouter
          </label>
          <input
            id={`${name}-key`}
            type="password"
            autoComplete="off"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className={`${field} mt-2 block w-full py-3`}
          />
          <p className="mt-2 mb-0 text-[13px] text-muted">
            Remy saves a key in the system keychain of the machine that runs it. This page never
            keeps it.
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
          Test the key first
        </button>
        <p role="status" className="m-0 text-[13px] text-muted">
          {note}
        </p>
      </div>
      <SkipSetup />
    </Frame>
  );
}

const APPS = [
  { name: 'Gmail', text: 'Read, draft, send with approval', connected: true },
  { name: 'Google Calendar', text: 'See your day, hold time', action: 'Connect Calendar' },
  { name: 'Notion', text: 'Read your pages', action: 'Connect Notion' },
];

function StepTwo() {
  return (
    <Frame
      at={1}
      title="Connect what Remy can reach."
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
            {a.connected ? (
              <span className="font-mono text-[13px] text-muted">Connected</span>
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
          Continue
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
      setError(e instanceof Error ? e.message : 'Remy could not start that.');
    }
  };
  return (
    <Frame
      at={2}
      title="Tell Remy what you need done."
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
          Start task
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
