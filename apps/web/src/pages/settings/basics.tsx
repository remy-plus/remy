// Trust, budget and appearance. Trust shows a row from each of the other small sections too, as the
// frame does, so the same rows are exported and reused. All values live in the settings store.
import type { TrustLevel } from '../../api/index.tsx';
import { useSetting } from '../../settings.ts';
import { Money, money, Row, Segmented, Toggle } from './controls.tsx';
import type { SectionProps } from './sections.ts';

const TRUST: Record<TrustLevel, { label: string; text: string }> = {
  ask: { label: 'Ask', text: 'Remy asks before it changes anything. This is the default.' },
  steady: {
    label: 'Steady',
    text: 'Remy reads, searches and edits files in its workspace without asking. It asks before anything that changes the outside world.',
  },
  away: {
    label: 'Away',
    text: 'Everything Steady does, and it saves skills. Made for long runs while you are away. Cards wait for you.',
  },
};
const TRUST_OPTIONS = (Object.keys(TRUST) as TrustLevel[]).map((value) => ({
  value,
  label: TRUST[value].label,
}));

export function TrustRow() {
  const [trust, setTrust] = useSetting('trust');
  return (
    <Row
      title="How much Remy does alone"
      help="Sending as you and spending money always ask, at every level."
    >
      <Segmented label="Trust level" value={trust} options={TRUST_OPTIONS} onChange={setTrust} />
      <p
        aria-live="polite"
        className="mt-4 mb-0 max-w-[500px] text-[15px] leading-relaxed text-muted"
      >
        <strong className="font-medium text-text">{TRUST[trust].label}.</strong> {TRUST[trust].text}
      </p>
      <p className="mt-2 mb-0 text-[13px] text-muted">A change applies to new tasks.</p>
    </Row>
  );
}

export function MonthlyBudgetRow({ data }: SectionProps) {
  const [cap, setCap] = useSetting('budget.month');
  const [perTask, setPerTask] = useSetting('budget.task');
  const symbol = data?.currency ?? '$';
  const used = data?.budget.usedMonth;
  const share = used === undefined || cap <= 0 ? 0 : Math.min(1, used / cap);
  return (
    <Row title="Monthly budget" help="Remy pauses and asks before going over.">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Money label="Monthly budget" symbol={symbol} value={cap} onChange={setCap} />
        {data && (
          <p className="m-0 font-mono text-[12px] text-muted">
            {money(symbol, data.budget.usedMonth)} used · {data.budget.daysLeft} days left
          </p>
        )}
      </div>
      {data && (
        <div
          role="progressbar"
          aria-label="Share of the monthly budget used"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
          className="mt-4 h-1 max-w-[420px] rounded-full bg-line"
        >
          <div className="h-full rounded-full bg-stone" style={{ width: `${share * 100}%` }} />
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Money label="Stop one task at" symbol={symbol} value={perTask} onChange={setPerTask} />
        <p className="m-0 text-[14px] text-muted">
          Per task, Remy stops and asks at {money(symbol, perTask)}.
        </p>
      </div>
    </Row>
  );
}

export function RememberRow() {
  const [memory, setMemory] = useSetting('memory');
  return (
    <Row title="Remember things about me" help="Notes stay on this machine.">
      <Toggle
        label="Learn from corrections and routines"
        help="Turn off to stop saving notes. Existing notes stay until you delete them."
        checked={memory}
        onChange={setMemory}
      />
    </Row>
  );
}

export function QuietRow() {
  const [quiet, setQuiet] = useSetting('quiet');
  return (
    <Row title="Quiet mode" help="For focus and for nights.">
      <Toggle
        label="Only interrupt for approvals"
        help="Remy keeps working and holds everything else until you open the app. The orb dims."
        checked={quiet}
        onChange={setQuiet}
      />
    </Row>
  );
}

export function AppearanceRow() {
  return (
    <Row title="Appearance" help="Dark is the default.">
      <Segmented
        label="Appearance"
        value="dark"
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light', disabled: true },
        ]}
        onChange={() => undefined}
      />
      <p className="mt-3 mb-0 text-[13px] text-muted">Light: not available yet.</p>
    </Row>
  );
}

export function Trust(props: SectionProps) {
  return (
    <>
      <TrustRow />
      <MonthlyBudgetRow {...props} />
      <RememberRow />
      <QuietRow />
      <AppearanceRow />
    </>
  );
}

export function Budget(props: SectionProps) {
  const [escalate] = useSetting('escalate');
  return (
    <>
      <p className="mt-0 mb-6 max-w-[560px] text-[16px] text-muted">
        Remy tells you before it goes over either limit.
      </p>
      <MonthlyBudgetRow {...props} />
      <Row title="When the stronger model is used" help="Set under Model and keys.">
        <p className="m-0 text-[14px] text-muted">
          {escalate
            ? 'Remy may move a hard task to the stronger model. It stays inside the limits above.'
            : 'Remy stays on the everyday model, even for hard tasks.'}
        </p>
      </Row>
    </>
  );
}

export function Appearance() {
  return (
    <>
      <AppearanceRow />
      <QuietRow />
    </>
  );
}
