import { useState } from 'react';
import { useApi } from '../../api/index.tsx';
import { Confirm } from '../../components/Confirm.tsx';
import { buttonQuiet } from '../../components/ui.ts';
import { Row } from './controls.tsx';
import type { SectionProps } from './sections.ts';

const gone = (what: string) => (
  <p className="m-0 text-[15px] text-muted">{what} is not available yet.</p>
);

export function Server({ data }: SectionProps) {
  const api = useApi();
  const [asking, setAsking] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  const [error, setError] = useState('');
  if (!data) return gone('The home server');

  const rotate = async () => {
    setAsking(false);
    try {
      setFresh((await api.rotateToken()).token);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The token could not be changed.');
    }
  };

  return (
    <>
      <Row title="Address" help="Where this browser reaches Remy.">
        <p className="m-0 font-mono text-[14px]">{data.server.address}</p>
      </Row>
      <Row title="Access token" help="Anyone with the token can use your Remy.">
        <button type="button" className={buttonQuiet} onClick={() => setAsking(true)}>
          Make a new token
        </button>
        {fresh && (
          <div role="status" className="mt-4">
            <p className="m-0 text-[13px] text-muted">
              Copy it now. Remy shows it once, and every signed-in device needs it.
            </p>
            <code className="mt-2 inline-block rounded-md border border-line bg-surface px-3 py-2 font-mono text-[13px] break-all">
              {fresh}
            </code>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 mb-0 text-[13px] text-muted">
            {error}
          </p>
        )}
      </Row>
      <Row title="Last sign-ins" help="Browsers and phones that used the token.">
        <ul className="m-0 p-0">
          {data.server.lastSignIns.map((s) => (
            <li
              key={s.at + s.where}
              className="flex list-none justify-between gap-4 border-b border-line py-2 text-[14px] first:pt-0 last:border-b-0"
            >
              <span>{s.where}</span>
              <span className="font-mono text-[12px] text-muted">{s.at}</span>
            </li>
          ))}
        </ul>
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

export function About({ data }: SectionProps) {
  if (!data) return gone('The version information');
  const rows: [string, string][] = [
    ['Version', data.about.version],
    ['Licences', data.about.licences],
    ['Data folder', data.about.dataDir],
  ];
  return (
    <dl className="m-0">
      {rows.map(([k, v]) => (
        <div
          key={k}
          className="grid gap-x-10 gap-y-1 border-t border-line py-5 md:grid-cols-[minmax(0,284px)_minmax(0,1fr)]"
        >
          <dt className="text-[15px] font-medium">{k}</dt>
          <dd className="m-0 font-mono text-[14px] break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
