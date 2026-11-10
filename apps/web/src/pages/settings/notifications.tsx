import { useState } from 'react';
import { useApi } from '../../api/index.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { type SettingKey, useSetting } from '../../settings.ts';
import { QuietRow } from './basics.tsx';
import { Row, Toggle } from './controls.tsx';

const time =
  'h-[38px] w-[130px] rounded-md border border-edge-hi bg-surface px-3 text-[14px] text-text outline-none focus-visible:border-text [color-scheme:dark]';

function Time({
  name,
  text,
  label,
}: {
  name: SettingKey & ('notify.review' | 'quiet.from' | 'quiet.to');
  text: string;
  label: string;
}) {
  const [value, set] = useSetting(name);
  return (
    <label className="flex items-center gap-2 text-[14px] text-muted">
      <span>{text}</span>
      <input
        type="time"
        aria-label={label}
        value={value}
        onChange={(e) => e.target.value && set(e.target.value)}
        className={time}
      />
    </label>
  );
}

export function Notifications() {
  const api = useApi();
  const [finished, setFinished] = useSetting('notify.finished');
  const [noticed, setNoticed] = useSetting('notify.noticed');
  const [sent, setSent] = useState('');
  const test = async () => {
    try {
      await api.sendTestNotification();
      setSent('A test notification was sent.');
    } catch (e) {
      setSent(e instanceof Error ? e.message : 'The test did not send.');
    }
  };
  return (
    <>
      <p className="mt-0 mb-6 max-w-[620px] text-[16px] text-muted">
        Remy interrupts you for approvals and for nothing else, unless you say so.
      </p>
      <Row title="Waiting for you" help="Sending, spending, anything it cannot undo.">
        <Toggle
          label="Phone and desktop push"
          help="Always on. Approvals are the one thing Remy will not hold back."
          checked
          disabled
          onChange={() => undefined}
        />
      </Row>
      <Row title="Job finished" help="When something you asked for is done.">
        <Toggle
          label="Tell me when a job finishes"
          help="Quiet in the app, a push only if you are away."
          checked={finished}
          onChange={setFinished}
        />
      </Row>
      <Row title="Things Remy noticed" help="Overdue invoices, price drops, a full disk.">
        <Toggle
          label="Send a push for things Remy noticed"
          help="Off: no push. They wait in the Noticed list on Home."
          checked={noticed}
          onChange={setNoticed}
        />
      </Row>
      <Row title="Overnight review" help="A summary of what ran while you were away.">
        <div className="flex flex-wrap items-center gap-4">
          <Time name="notify.review" text="Send it at" label="Overnight review: send it at" />
          <span className="text-[14px] text-muted">every day, after quiet hours</span>
        </div>
      </Row>
      <Row title="Quiet hours" help="Only approvals get through.">
        <div className="flex flex-wrap items-center gap-4">
          <Time name="quiet.from" text="From" label="Quiet hours from" />
          <Time name="quiet.to" text="Until" label="Quiet hours until" />
          <span className="text-[14px] text-muted">turns quiet mode on and off by itself</span>
        </div>
      </Row>
      <QuietRow />
      <div className="flex flex-wrap items-center gap-4 border-t border-edge pt-5">
        <button type="button" className={buttonQuiet} onClick={test}>
          Send a test notification
        </button>
        <p role="status" className="m-0 text-[13px] text-muted">
          {sent}
        </p>
      </div>
    </>
  );
}
