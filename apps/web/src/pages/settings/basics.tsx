// Trust, spending and the small rows other sections reuse. All values live in the settings store.
import { useState } from 'react';
import type { TrustLevel } from '../../api/index.tsx';
import { useSetting } from '../../settings.ts';
import { Money, money, Row, Segmented, Toggle } from './controls.tsx';
import type { SectionProps } from './sections.ts';

const TRUST: Record<TrustLevel, { label: string; text: string }> = {
  ask: {
    label: 'Check with me first',
    text: 'Remy asks before it does anything, which is the default.',
  },
  steady: {
    label: 'Handle routine things',
    text: 'Remy does short, low-risk, reversible work in its workspace, like reading and editing files, without asking; spending, sending, deleting and anything after untrusted content still wait for you.',
  },
  away: {
    label: "Work on its own while I'm away",
    text: 'Remy clears a little more for long runs while you are away, but spending, sending, deleting and anything after untrusted content still wait for you.',
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
      title="Choose a level"
      help="Sending as you and spending money always wait for you, at every level."
    >
      <Segmented label="Trust level" value={trust} options={TRUST_OPTIONS} onChange={setTrust} />
      <p
        aria-live="polite"
        className="mt-4 mb-0 max-w-[500px] text-[15px] leading-relaxed text-muted"
      >
        <strong className="font-medium text-text">{TRUST[trust].label}.</strong> {TRUST[trust].text}
      </p>
      <p className="mt-2 mb-0 text-[13px] text-muted">A change applies to new jobs.</p>
    </Row>
  );
}

export function MonthlyBudgetRow({ data }: SectionProps) {
  const [cap, setCap] = useSetting('budget.month');
  const [perTask, setPerTask] = useSetting('budget.task');
  const [code] = useSetting('currency.code');
  const [rate] = useSetting('currency.rate');
  const symbol = symbolFor(code);
  const used = data?.budget.usedMonth;
  const share = used === undefined || cap <= 0 ? 0 : Math.min(1, used / cap);
  return (
    <Row title="Monthly budget" help="Once the month's budget is used, Remy starts no new jobs.">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Money
          key={`${code}${rate}`}
          label="Monthly budget"
          symbol={symbol}
          value={shown(cap, rate)}
          onChange={(v) => setCap(v / rate)}
        />
        {data && (
          <p className="m-0 text-[13px] text-muted">
            {money(symbol, data.budget.usedMonth * rate)} used, {data.budget.daysLeft} days left
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
        <Money
          key={`${code}${rate}`}
          label="Stop a job at"
          symbol={symbol}
          value={shown(perTask, rate)}
          onChange={(v) => setPerTask(v / rate)}
        />
        <p className="m-0 text-[14px] text-muted">
          Per job, Remy stops and asks at {money(symbol, perTask * rate)}.
        </p>
      </div>
    </Row>
  );
}

const shown = (usd: number, rate: number) => Math.round(usd * rate * 100) / 100;

/** The sign for a three-letter code, or the code when the browser has none. */
export function symbolFor(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

const validCode = (code: string) => {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
};

export function CurrencyRow() {
  const [code, setCode] = useSetting('currency.code');
  const [rate, setRate] = useSetting('currency.rate');
  const [codeText, setCodeText] = useState(code);
  const [rateText, setRateText] = useState(String(rate));
  const bad = codeText !== code && !validCode(codeText.toUpperCase());
  return (
    <Row title="Currency" help="Only how amounts are shown. Remy is billed in US dollars.">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-[13px] text-muted">
          Code
          <input
            aria-label="Currency code"
            aria-invalid={bad}
            maxLength={3}
            value={codeText}
            onChange={(e) => {
              const v = e.target.value.toUpperCase();
              setCodeText(v);
              if (validCode(v)) setCode(v);
            }}
            className="h-[38px] w-[88px] rounded-md border border-edge-hi bg-surface px-3 text-[13px] text-text outline-none focus:border-text"
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-muted">
          {`${code} for 1 USD`}
          <input
            aria-label="Amount of this currency in one US dollar"
            type="number"
            inputMode="decimal"
            min={0}
            step="any"
            value={rateText}
            onChange={(e) => {
              setRateText(e.target.value);
              const n = Number.parseFloat(e.target.value);
              if (Number.isFinite(n) && n > 0) setRate(n);
            }}
            className="h-[38px] w-[120px] rounded-md border border-edge-hi bg-surface px-3 text-[13px] text-text outline-none focus:border-text"
          />
        </label>
      </div>
      <p className="mt-3 mb-0 text-[13px] text-muted">
        {bad
          ? 'Use a three-letter code such as USD, GBP or INR.'
          : 'You set the rate; Remy does not look it up.'}
      </p>
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
        help="Remy keeps working and holds everything else until you open the app. Its mark dims."
        checked={quiet}
        onChange={setQuiet}
      />
      {quiet && (
        <p className="mt-3 mb-0 text-[13px]">
          <a href="#/quiet" className="text-text underline">
            Open the quiet screen
          </a>
        </p>
      )}
    </Row>
  );
}

export function Trust() {
  return <TrustRow />;
}

export function Budget(props: SectionProps) {
  const [escalate] = useSetting('escalate');
  return (
    <>
      <p className="mt-0 mb-6 max-w-[560px] text-[16px] text-muted">
        Remy stops a job at its limit and asks before going on. Once the month's budget is used, it
        starts no new jobs.
      </p>
      <MonthlyBudgetRow {...props} />
      <CurrencyRow />
      <Row title="When the stronger model is used" help="Set under Model and keys.">
        <p className="m-0 text-[14px] text-muted">
          {escalate
            ? 'Remy may move a hard job to the stronger model. It stays inside the limits above.'
            : 'Remy stays on the everyday model, even for hard tasks.'}
        </p>
      </Row>
    </>
  );
}
