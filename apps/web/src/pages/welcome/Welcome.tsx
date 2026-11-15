// First run: two steps, each with the orb on the right. Step 1 connects a model right here: pick a
// provider, paste the key, and the server checks it and keeps it on the machine that runs Remy (the
// key never comes back to this page). Step 2 welcomes the person and gets them to a first answer.
import { type ReactNode, useEffect, useState } from 'react';
import type { ConnectedApp, ModelSaved, ModelSetup } from '../../api/index.tsx';
import { useApi } from '../../api/index.tsx';
import { AsciiMark, DotField } from '../../components/AsciiMark.tsx';
import { CopyCommand } from '../../components/CopyCommand.tsx';
import { Icon } from '../../components/Icon.tsx';
import { Logo } from '../../components/Logo.tsx';
import { ModelKeyForm } from '../../components/ModelKeyForm.tsx';
import { Orb } from '../../components/Orb.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { buttonPrimary, buttonQuiet } from '../../components/ui.ts';
import { announceChatsChanged } from '../../lib/chat-events.ts';
import { describeError } from '../../lib/errors.ts';
import { firstSuggestions, spendingLine } from '../../lib/suggestions.ts';
import { setSetting, useSetting } from '../../settings.ts';
import { hasToken } from './useFirstRun.ts';

const STEPS = ['Connect a model', 'Ask for something'];
const LABELS = [
  [{ label: 'you' }, { label: 'memory' }],
  [{ label: 'you' }, { label: 'web' }],
];
const CAPTION: [string, string][] = [
  ["I'm your assistant.", 'I ask before I send anything as you or spend money. Always.'],
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

function StepOne() {
  const api = useApi();
  const [setup, setSetup] = useState<ModelSetup | null>(null);
  const [problem, setProblem] = useState('');
  const [saved, setSaved] = useState<ModelSaved | null>(null);
  const [changing, setChanging] = useState(false);
  const [tries, setTries] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `tries` asks again after a failure
  useEffect(() => {
    let live = true;
    if (!api.modelSetup) return;
    setProblem('');
    api.modelSetup().then(
      (d) => live && setSetup(d),
      (e) =>
        live &&
        setProblem(
          describeError(
            e,
            'Remy could not check its model. Check that it is running, then try again.',
          ),
        ),
    );
    return () => {
      live = false;
    };
  }, [api, tries]);

  const ready = setup?.ready === true;
  return (
    <Frame
      at={0}
      title="Hi, I'm Remy."
      lead="First I need a model to think with. Pick a provider and paste your key. I check it, keep it on this computer, and never show it again."
    >
      {!api.modelSetup ? (
        <div>
          <p className="font-mono m-0 text-[12px] text-muted">Add your key in a terminal</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <code className="font-mono rounded-[6px] border border-edge bg-raise px-3 py-2 text-[13px]">
              remy login
            </code>
            <CopyCommand command="remy login" title="sign in" what="run" label="Copy" />
          </div>
          <p className="mt-2 mb-0 text-[13px] text-muted">
            This server cannot take a key from the browser. The key goes in the Keychain on this
            computer.
          </p>
        </div>
      ) : problem ? (
        <div>
          <p role="alert" className="m-0 text-[14px] text-text">
            {problem}
          </p>
          <button
            type="button"
            className={`${buttonQuiet} mt-4 px-5 py-3`}
            onClick={() => setTries((n) => n + 1)}
          >
            Try again
          </button>
        </div>
      ) : !setup ? (
        <Skeleton label="Checking which model Remy has" lines={3} />
      ) : ready && !changing && !saved ? (
        <div>
          <p
            role="status"
            className="m-0 flex items-start gap-2 text-[14px] leading-snug text-text"
          >
            <Icon name="check" className="mt-0.5 shrink-0 text-signal" />
            <span>
              Remy is already connected{setup.current?.label ? ` to ${setup.current.label}` : ''},
              using {setup.current?.model}.
            </span>
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <a className={`${buttonPrimary} px-5 py-3 no-underline`} href="#/welcome/2">
              Continue
            </a>
            <button
              type="button"
              className={`${buttonQuiet} px-5 py-3`}
              onClick={() => setChanging(true)}
            >
              Use a different one
            </button>
          </div>
        </div>
      ) : (
        <div>
          <ModelKeyForm setup={setup} onSaved={setSaved} />
          {saved && (
            <div className="mt-5">
              <a className={`${buttonPrimary} px-5 py-3 no-underline`} href="#/welcome/2">
                Continue
              </a>
            </div>
          )}
        </div>
      )}
      <SkipSetup />
    </Frame>
  );
}

const oneLine = (names: string[]) =>
  names.length === 0
    ? 'Nothing is connected yet, so I start with the web and files.'
    : `Connected: ${names.join(', ')}.`;

function StepTwo() {
  const api = useApi();
  const [monthly] = useSetting('budget.month');
  const [perTask] = useSetting('budget.task');
  const [code] = useSetting('currency.code');
  const [rate] = useSetting('currency.rate');
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  useEffect(() => {
    // Onboarding is reachable without a session, and a 401 here would send the person to sign-in
    // mid-setup. So ask only when there is a session to ask with; otherwise claim nothing.
    if (!hasToken()) return;
    let live = true;
    api.connections().then(
      (d) => live && setApps(d.apps),
      () => {}, // a server that cannot answer is not evidence that anything is connected
    );
    return () => {
      live = false;
    };
  }, [api]);
  const connected = apps.filter((a) => a.status === 'connected').map((a) => a.name);
  const ask = async () => {
    const prompt = text.trim();
    if (!prompt || sending) return;
    setSending(true);
    setError('');
    try {
      const { chatId } = await api.sendMessage(prompt, undefined);
      announceChatsChanged();
      finish();
      window.location.hash = `#/chat/${encodeURIComponent(chatId)}`;
    } catch (e) {
      setError(describeError(e, 'Remy could not start that. Try again.'));
    } finally {
      setSending(false);
    }
  };
  const spending = spendingLine({ monthly, perTask, code, rate });
  return (
    <Frame
      at={1}
      title="You are set. What do you need done?"
      lead={`I can search the web, read pages and work with files in my own folder. ${oneLine(connected)} Add Gmail, Calendar and more any time in Connections.`}
    >
      <div className="flex gap-3 rounded-[14px] border border-control bg-surface p-3.5 focus-within:border-text">
        <textarea
          aria-label="What you need done"
          placeholder="Ask anything you would do on a computer"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void ask();
            }
          }}
          className="min-w-0 flex-1 resize-none border-0 bg-transparent p-1.5 text-[17px] text-text outline-none placeholder:text-muted"
        />
        <button
          type="button"
          className={`${buttonPrimary} h-fit px-5 py-3`}
          disabled={!text.trim() || sending}
          onClick={ask}
        >
          Ask Remy
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-3 mb-0 text-[14px] text-text">
          {error}
        </p>
      )}
      <h2 className="font-mono mt-6 mb-3 text-[12px] font-normal text-muted">
        Or try one of these
      </h2>
      <ul className="m-0 grid gap-2.5 p-0">
        {firstSuggestions({ code, rate }).map((t) => (
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
      <ul className="mt-6 mb-0 grid gap-1.5 p-0 text-[13px] leading-snug text-muted">
        <li className="list-none">
          {spending.cap}{' '}
          <a className="text-text underline" href="#/settings/budget">
            Change it in Settings.
          </a>
        </li>
        <li className="list-none">
          {spending.currency}{' '}
          <a className="text-text underline" href="#/settings/budget">
            Change it in Settings.
          </a>
        </li>
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
        className="cursor-pointer border-0 bg-transparent px-0 py-1.5 text-[13px] text-muted underline hover:text-text"
      >
        Skip setup and open Remy
      </button>
    </p>
  );
}

export function Welcome({ step = '1' }: { step?: string }) {
  // Step 3 was the old "ask" step; an old link to it still lands on the right screen.
  if (step === '2' || step === '3') return <StepTwo />;
  return <StepOne />;
}
