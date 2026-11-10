// Model and keys. Which provider is in use is mock-only for now; keys are never held by the browser.
import { useState } from 'react';
import { type Provider, useApi } from '../../api/index.tsx';
import { buttonPrimary, buttonQuiet } from '../../components/ui.ts';
import { useSetting } from '../../settings.ts';
import { Toggle } from './controls.tsx';
import type { SectionProps } from './sections.ts';

const STATE: Record<Provider['state'], string> = {
  key_in_use: 'Key saved',
  key_saved: 'Key saved',
  running: 'Running',
  no_key: 'No key',
};

const heading = 'font-mono m-0 mb-3 text-[12px] font-normal text-muted';

function ProviderRow({ p, inUse, onUse }: { p: Provider; inUse: boolean; onUse: () => void }) {
  const [note, setNote] = useState(false);
  const hasKey = p.state === 'key_in_use' || p.state === 'key_saved';
  const status = `${STATE[p.state]}${inUse ? ' · in use' : ''}`;
  return (
    <li className="list-none border-b border-edge py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-60">
          <h4 className="m-0 text-[15px] font-medium">{p.name}</h4>
          <p className="mt-1 mb-0 text-[14px] text-muted">{p.note}</p>
        </div>
        <span className={`font-mono text-[12px] ${inUse ? 'text-signal' : 'text-muted'}`}>
          {status}
        </span>
        {p.state === 'running' && !inUse ? (
          <button type="button" className={`${buttonQuiet} w-[150px] py-2.5`} onClick={onUse}>
            Use this instead
          </button>
        ) : (
          <button
            type="button"
            className={`${buttonQuiet} w-[150px] py-2.5`}
            aria-expanded={note}
            onClick={() => setNote(!note)}
          >
            {hasKey ? 'Replace key' : 'Add a key'}
          </button>
        )}
      </div>
      {note && (
        <p role="status" className="mt-3 mb-0 text-[13px] text-muted">
          Run <code className="font-mono text-text">remy login</code> on the machine that runs Remy
          to save a key for {p.name}. The browser never holds your keys, and this page cannot save
          one yet.
        </p>
      )}
    </li>
  );
}

export function Model({ data }: SectionProps) {
  const api = useApi();
  const [escalate, setEscalate] = useSetting('escalate');
  const [chosen, setChosen] = useState<string | null>(null);
  const [test, setTest] = useState<{ busy: boolean; text: string }>({ busy: false, text: '' });
  if (!data)
    return <p className="m-0 text-[15px] text-muted">The model settings are not available yet.</p>;
  const current = chosen ?? data.providers.find((p) => p.state === 'key_in_use')?.id;

  const run = async () => {
    setTest({ busy: true, text: '' });
    try {
      const r = await api.testModels();
      setTest({ busy: false, text: r.detail });
    } catch (e) {
      setTest({ busy: false, text: e instanceof Error ? e.message : 'The test did not run.' });
    }
  };

  return (
    <>
      <h3 className={heading}>Providers</h3>
      <ul className="m-0 border-t border-edge p-0">
        {data.providers.map((p) => (
          <ProviderRow key={p.id} p={p} inUse={p.id === current} onUse={() => setChosen(p.id)} />
        ))}
      </ul>

      <h3 className={`${heading} mt-8`}>Which model does what</h3>
      <dl className="m-0 grid max-w-[620px] grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 sm:grid-cols-[192px_minmax(0,1fr)]">
        <dt className="self-center text-[15px]">Everyday tasks</dt>
        <dd className="m-0 rounded-md border border-edge-hi bg-surface px-3 py-[9px] font-mono text-[13px]">
          {data.models.everyday} · {data.models.everydayCost}
        </dd>
        <dt className="self-center text-[15px]">Hard tasks</dt>
        <dd className="m-0 rounded-md border border-edge-hi bg-surface px-3 py-[9px] font-mono text-[13px]">
          {data.models.hard} · {data.models.hardCost}
        </dd>
      </dl>
      <div className="mt-5 max-w-[620px]">
        <Toggle
          label="Move up to the stronger model when a task is hard"
          help="Remy decides, and tells you when it does. It stays inside your budget."
          checked={escalate}
          onChange={setEscalate}
        />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="button" className={buttonPrimary} disabled={test.busy} onClick={run}>
          Test both models
        </button>
        <p role="status" className="m-0 text-[13px] text-muted">
          {test.busy ? 'Testing' : test.text}
        </p>
      </div>
    </>
  );
}
