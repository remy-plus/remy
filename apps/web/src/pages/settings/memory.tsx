import { useState } from 'react';
import { useApi } from '../../api/index.tsx';
import { Confirm } from '../../components/Confirm.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { RememberRow } from './basics.tsx';
import { Row } from './controls.tsx';
import type { SectionProps } from './sections.ts';

export function Memory({ data, reload }: SectionProps) {
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
      setResult(e instanceof Error ? e.message : 'The notes could not be deleted.');
    } finally {
      setBusy(false);
      setAsking(false);
    }
  };

  return (
    <>
      <RememberRow />
      <Row title="Your notes" help="What Remy saved about you and your work.">
        {data ? (
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
        ) : (
          <p className="m-0 text-[14px] text-muted">The notes count is not available yet.</p>
        )}
        <p role="status" className="mt-3 mb-0 text-[13px] text-muted">
          {result}
        </p>
      </Row>
      <Row title="Where your data goes">
        <p className="m-0 max-w-[560px] text-[14px] leading-relaxed text-muted">
          Notes, jobs and keys stay on the machine that runs Remy. Remy sends text only to the model
          you chose and to the apps you connected.
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
