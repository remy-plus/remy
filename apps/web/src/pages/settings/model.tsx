// Model and keys. A key is saved on the machine that runs Remy and never comes back to this browser,
// so this page shows which providers have one and how to add or replace it; it never asks for a key.
import { useState } from 'react';
import { type Provider, useApi } from '../../api/index.tsx';
import { Skeleton } from '../../components/Skeleton.tsx';
import { buttonPrimary, buttonQuiet } from '../../components/ui.ts';
import { describeError } from '../../lib/errors.ts';
import { useSetting } from '../../settings.ts';
import { Unavailable } from '../connect/ui.tsx';
import { SaveNote, Toggle, useOwnSave } from './controls.tsx';
import type { SectionProps } from './sections.ts';
import { VoiceRow } from './voice.tsx';

const STATE: Record<Provider['state'], string> = {
  key_in_use: 'Key saved',
  key_saved: 'Key saved',
  running: 'Running on this machine',
  no_key: 'No key yet',
};

const heading = 'font-mono m-0 mb-3 text-[12px] font-normal text-muted';

function ProviderRow({ p, inUse }: { p: Provider; inUse: boolean }) {
  const [note, setNote] = useState(false);
  const hasKey = p.state === 'key_in_use' || p.state === 'key_saved';
  return (
    <li className="list-none border-b border-edge py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1 basis-60">
          <h4 className="m-0 text-[15px] font-medium">{p.name}</h4>
          <p className="mt-1 mb-0 text-[14px] text-muted">{p.note}</p>
        </div>
        <span className={`text-[13px] ${inUse ? 'text-signal' : 'text-muted'}`}>
          {STATE[p.state]}
          {inUse ? ' · in use' : ''}
        </span>
        {/* A provider running on this machine needs no key, so it gets no key button. */}
        {p.state !== 'running' && (
          <button
            type="button"
            className={`${buttonQuiet} py-2.5`}
            aria-expanded={note}
            onClick={() => setNote(!note)}
          >
            {hasKey ? 'How to replace the key' : 'How to add a key'}
          </button>
        )}
      </div>
      {note && (
        <p role="status" className="mt-3 mb-0 max-w-[560px] text-[13px] leading-relaxed text-muted">
          {hasKey
            ? `A key for ${p.name} is saved on the machine that runs Remy. It never comes back to this browser. To replace it, run `
            : `To add a key for ${p.name}, run `}
          <code className="font-mono text-text">remy login</code>
          {' on the machine that runs Remy. The key stays there; this browser never holds it.'}
        </p>
      )}
    </li>
  );
}

export function Model({ data, error, reload }: SectionProps) {
  const api = useApi();
  const [escalate, setEscalate] = useSetting('escalate');
  const [test, setTest] = useState<{ busy: boolean; text: string }>({ busy: false, text: '' });
  const voiceSave = useOwnSave();
  if (!data)
    return error ? (
      <Unavailable message={error} onRetry={reload} />
    ) : (
      <Skeleton label="Loading your models and keys" lines={5} />
    );
  const current = data.providers.find((p) => p.state === 'key_in_use')?.id;

  const run = async () => {
    setTest({ busy: true, text: '' });
    try {
      const r = await api.testModels();
      setTest({ busy: false, text: r.detail || 'Both models answered.' });
    } catch (e) {
      setTest({
        busy: false,
        text: describeError(e, 'The test did not run. Check that Remy is running, then try again.'),
      });
    }
  };

  return (
    <>
      <h3 className={heading}>Providers</h3>
      <p className="mt-0 mb-4 max-w-[560px] text-[14px] leading-relaxed text-muted">
        Keys are saved on the machine that runs Remy, never in this browser, and Remy never shows a
        saved key again. To change which provider Remy uses, run{' '}
        <code className="font-mono text-text">remy login</code> on that machine.
      </p>
      <ul className="m-0 border-t border-edge p-0">
        {data.providers.map((p) => (
          <ProviderRow key={p.id} p={p} inUse={p.id === current} />
        ))}
      </ul>
      {data.providers.length === 0 && (
        <p className="mt-4 mb-0 max-w-[560px] text-[15px] leading-relaxed text-muted">
          No provider is set up yet. Run <code className="font-mono text-text">remy login</code> on
          the machine that runs Remy to add one, then reload this page.
        </p>
      )}

      <h3 className={`${heading} mt-8`}>Which model does what</h3>
      <p className="mt-0 mb-4 max-w-[560px] text-[14px] leading-relaxed text-muted">
        Everyday jobs use the cheaper model. Hard jobs use the stronger one, and the cost beside
        each is what one job usually costs.
      </p>
      <dl className="m-0 grid max-w-[620px] grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 sm:grid-cols-[192px_minmax(0,1fr)]">
        <dt className="self-center text-[15px]">Everyday jobs</dt>
        <dd className="m-0 rounded-md border border-edge-hi bg-surface px-3 py-[9px] font-mono text-[13px]">
          {data.models.everyday} · {data.models.everydayCost}
        </dd>
        <dt className="self-center text-[15px]">Hard jobs</dt>
        <dd className="m-0 rounded-md border border-edge-hi bg-surface px-3 py-[9px] font-mono text-[13px]">
          {data.models.hard} · {data.models.hardCost}
        </dd>
      </dl>
      <div className="mt-5 max-w-[620px]">
        <Toggle
          label="Move up to the stronger model when a job is hard"
          help="Remy decides, and tells you when it does. It stays inside your budget."
          checked={escalate}
          onChange={setEscalate}
        />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-4">
        <button type="button" className={buttonPrimary} disabled={test.busy} onClick={run}>
          Test both models
        </button>
        <p role="status" className="m-0 max-w-[420px] text-[13px] text-muted">
          {test.busy ? 'Testing both models' : test.text}
        </p>
      </div>

      <h3 className={`${heading} mt-8`}>Voice</h3>
      {/* The voice id is written from inside VoiceRow; catching the change here lets this section say
          whether that write landed, without reaching into that file. */}
      <div onChange={voiceSave.touch}>
        <VoiceRow data={data} />
      </div>
      <SaveNote state={voiceSave.state} what="voice" />
    </>
  );
}
