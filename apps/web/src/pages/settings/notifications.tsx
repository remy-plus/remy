import { useState } from 'react';
import { useApi } from '../../api/index.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
import { clock } from '../../lib/when.ts';
import { type SettingKey, useSetting } from '../../settings.ts';
import { QuietRow } from './basics.tsx';
import { Row, Toggle } from './controls.tsx';

const time =
  'h-[38px] w-[130px] rounded-md border border-edge-hi bg-surface px-3 text-[14px] text-text outline-none focus-visible:border-text [color-scheme:dark]';

/** "11:00 PM" for a stored "23:00". A clock is unavoidable here, so it is a 12-hour one. */
const plain = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return clock(d);
};

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
  const [review] = useSetting('notify.review');
  const [from] = useSetting('quiet.from');
  const [to] = useSetting('quiet.to');
  const [sent, setSent] = useState('');
  const [sending, setSending] = useState(false);
  const test = async () => {
    setSending(true);
    try {
      await api.sendTestNotification();
      setSent(
        'A test notification was sent. If nothing arrived, check that this site may send notifications.',
      );
    } catch (e) {
      setSent(
        describeError(e, 'The test did not send. Check that Remy is running, then try again.'),
      );
    } finally {
      setSending(false);
    }
  };
  return (
    <>
      <p className="mt-0 mb-6 max-w-[620px] text-[16px] text-muted">
        Remy interrupts you for approvals and for nothing else, unless you say so.
      </p>
      <Row title="Waiting for you" help="Sending, spending and anything it cannot undo.">
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
        <Time name="notify.review" text="Send it at" label="Overnight review: send it at" />
        <p className="mt-3 mb-0 text-[13px] text-muted">
          Remy sends it at {plain(review)} every day, once quiet hours are over.
        </p>
      </Row>
      <Row
        title="Quiet hours"
        help="Only approvals get through. Remy turns quiet mode on and off by itself at these times."
      >
        <div className="flex flex-wrap items-center gap-4">
          <Time name="quiet.from" text="From" label="Quiet hours from" />
          <Time name="quiet.to" text="Until" label="Quiet hours until" />
        </div>
        <p className="mt-3 mb-0 text-[13px] text-muted">
          Quiet from {plain(from)} until {plain(to)}.
        </p>
      </Row>
      <QuietRow />
      <div className="flex flex-wrap items-center gap-4 border-t border-edge pt-5">
        <button type="button" className={buttonQuiet} disabled={sending} onClick={test}>
          {sending ? 'Sending the test' : 'Send a test notification'}
        </button>
        <p role="status" className="m-0 max-w-[520px] text-[13px] text-muted">
          {sent}
        </p>
      </div>
    </>
  );
}
