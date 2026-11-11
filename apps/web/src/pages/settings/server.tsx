import { useState } from 'react';
import { type SettingsData, useApi } from '../../api/index.tsx';
import { Confirm } from '../../components/Confirm.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
import { ago } from '../../lib/when.ts';
import { Unavailable } from '../connect/ui.tsx';
import { Row } from './controls.tsx';
import type { SectionProps } from './sections.ts';

function Server({ data }: { data: SettingsData }) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState('');

  const rotate = async () => {
    setAsking(false);
    try {
      setFresh((await api.rotateToken()).token);
      setError('');
    } catch (e) {
      setError(
        describeError(
          e,
          'The token could not be changed. Check that Remy is running, then try again.',
        ),
      );
    }
  };

  return (
    <>
      <Row title="Address" help="Where this browser reaches Remy.">
        <p className="m-0 text-[15px] break-words">{data.server.address}</p>
      </Row>
      <Row
        title="Access token"
        help="Anyone with the token can use your Remy. It is made on the machine that runs Remy; this browser keeps only the copy you signed in with."
      >
        <button type="button" className={buttonQuiet} onClick={() => setAsking(true)}>
          Make a new token
        </button>
        {fresh && (
          <div role="status" className="mt-4">
            <p className="m-0 text-[13px] text-muted">
              Copy it now. Remy shows it once, and every signed-in device needs it.
            </p>
            <code className="mt-2 inline-block rounded-md border border-edge bg-surface px-3 py-2 font-mono text-[13px] break-all">
              {fresh}
            </code>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 mb-0 max-w-[520px] text-[13px] text-muted">
            {error}
          </p>
        )}
      </Row>
      <Row title="Last sign-ins" help="Browsers and phones that used the token.">
        {data.server.lastSignIns.length === 0 ? (
          <p className="m-0 max-w-[520px] text-[15px] leading-relaxed text-muted">
            Nothing has signed in yet. Open the address above on your phone and enter the token to
            add it here.
          </p>
        ) : (
          <ul className="m-0 p-0">
            {data.server.lastSignIns.map((s) => (
              <li
                key={s.at + s.where}
                className="flex list-none justify-between gap-4 border-b border-edge py-2 text-[14px] first:pt-0 last:border-b-0"
              >
                <span>{s.where}</span>
                <span className="text-[13px] text-muted">{ago(s.at) || s.at}</span>
              </li>
            ))}
          </ul>
        )}
      </Row>
      <Confirm
        open={asking}
        title="Make a new token?"
        confirmLabel="Make a new token"
        cancelLabel="Keep the old one"
        onConfirm={rotate}
        onCancel={() => setAsking(false)}
      >
        The old token stops working at once. Every browser and phone signed in with it will need the
        new one.
      </Confirm>
    </>
  );
}

function About({ data }: { data: SettingsData }) {
  const rows: [string, string, string][] = [
    ['Version', data.about.version, 'Which build of Remy is running here.'],
    ['Licences', data.about.licences, 'What Remy is built on, and under which licence.'],
    [
      'Data folder',
      data.about.dataDir,
      'Where Remy keeps its files, notes and keys on this machine.',
    ],
  ];
  return (
    <dl className="m-0">
      {rows.map(([k, v, help]) => (
        <div
          key={k}
          className="grid gap-x-10 gap-y-1 border-t border-edge py-5 md:grid-cols-[minmax(0,284px)_minmax(0,1fr)]"
        >
          <dt className="text-[15px] font-medium">
            {k}
            <span className="mt-1 block text-[13px] font-normal text-muted">{help}</span>
          </dt>
          <dd className="m-0 text-[15px] break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** This computer: where Remy is reached, the access token, and what is installed. */
export function Computer({ data, error, reload }: SectionProps) {
  if (!data)
    return error ? (
      <Unavailable message={error} onRetry={reload} />
    ) : (
      <Skeleton label="Loading this computer's details" lines={4} />
    );
  return (
    <>
      <Server data={data} />
      <About data={data} />
    </>
  );
}
