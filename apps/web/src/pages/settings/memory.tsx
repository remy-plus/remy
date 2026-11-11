import { useState } from 'react';
import { useApi } from '../../api/index.tsx';
import { Confirm } from '../../components/Confirm.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
import { RememberRow } from './basics.tsx';
import { Row, RowError } from './controls.tsx';
import type { SectionProps } from './sections.ts';

export function Memory({ data, error, reload }: SectionProps) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const count = data?.notes ?? 0;
  const n = count.toLocaleString('en');

  const remove = async () => {
    setBusy(true);
    try {
      const { deleted } = await api.deleteNotes(count);
      setResult(`Deleted ${deleted.toLocaleString('en')} ${deleted === 1 ? 'note' : 'notes'}.`);
      reload();
    } catch (e) {
      setResult(
        describeError(
          e,
          'The notes could not be deleted. Check that Remy is running, then try again.',
        ),
      );
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <>
      <RememberRow />
      <Row
        title="Your notes"
        help="What Remy saved about you and your work. They stay on this machine."
      >
        {data ? (
          count === 0 ? (
            <p className="m-0 max-w-[520px] text-[15px] leading-relaxed text-muted">
              Remy has not saved a note yet. It writes one when it learns a routine or you correct
              it.{' '}
              <a href="#/brain" className="text-text underline">
                See what Remy knows
              </a>
            </p>
          ) : (
            <>
              <p className="mt-0 mb-3 text-[15px]">
                {n} {count === 1 ? 'note' : 'notes'} on this machine.
              </p>
              <button
                type="button"
                className={buttonQuiet}
                disabled={count === 0}
                onClick={() => setAsking(true)}
              >
                Delete all notes
              </button>
            </>
          )
        ) : error ? (
          <RowError message={error} onRetry={reload} />
        ) : (
          <Skeleton label="Loading your notes" lines={2} />
        )}
        <p role="status" className="mt-3 mb-0 text-[13px] text-muted">
          {result}
        </p>
      </Row>
      <Row title="Where your data goes">
        <p className="m-0 max-w-[560px] text-[14px] leading-relaxed text-muted">
          Notes, jobs and keys stay on the machine that runs Remy. Remy sends text only to the model
          you chose and to the apps you connected.{' '}
          <a href="#/connections" className="text-text underline">
            See your connections
          </a>
        </p>
      </Row>
      <Confirm
        open={asking}
        title={`Delete ${n} ${count === 1 ? 'note' : 'notes'}?`}
        confirmLabel={`Delete ${n} ${count === 1 ? 'note' : 'notes'}`}
        cancelLabel="Keep my notes"
        busy={busy}
        onConfirm={remove}
        onCancel={() => setAsking(false)}
      >
        Remy forgets everything it saved about you. This cannot be undone.
      </Confirm>
    </>
  );
}
