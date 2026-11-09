import { useState } from 'react';
import type { ConnectedApp, Machine } from '../../api/index.tsx';
import {
  AppLogo,
  Eyebrow,
  Loading,
  mono,
  Notice,
  Page,
  primary,
  quiet,
  Switch,
  Unavailable,
  useLoad,
} from './ui.tsx';

type Selected = { kind: 'app'; id: string } | { kind: 'machine'; name: string };

const STATUS: Record<ConnectedApp['status'], string> = {
  connected: 'Connected',
  needs_signin: 'Needs sign-in',
  not_connected: 'Not connected',
};

const row = 'flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line py-4';

export function Connections() {
  const { api, data, setData, error } = useLoad((a) => a.connections());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [said, setSaid] = useState('');
  if (error) return <Unavailable message={error} />;
  if (!data) return <Loading />;

  const first = data.apps.find((a) => a.status === 'connected') ?? data.apps[0];
  const current: Selected | null = selected ?? (first ? { kind: 'app', id: first.id } : null);
  const app = current?.kind === 'app' ? data.apps.find((a) => a.id === current.id) : undefined;
  const machine =
    current?.kind === 'machine' ? data.machines.find((m) => m.name === current.name) : undefined;

  const refresh = async () => setData(await api.connections());
  const act = async (fn: () => Promise<void>, line: string) => {
    try {
      await fn();
      await refresh();
      setSaid(line);
    } catch (e) {
      setSaid(
        e instanceof Error
          ? e.message
          : 'That did not work. Check that Remy is still running, then try again.',
      );
    }
  };
  const connected = data.apps.filter((a) => a.status === 'connected').length;

  return (
    <Page
      title="Connections"
      lead="What Remy can reach. It asks before it sends anything as you or spends money."
      aside={
        <Panel
          app={app}
          machine={machine}
          said={said}
          onToggle={(permId, on) =>
            app &&
            act(
              () => api.setPermission(app.id, permId, on),
              `${app.name}: ${app.permissions.find((p) => p.id === permId)?.label} is ${on ? 'on' : 'off'}.`,
            )
          }
          onDisconnect={() =>
            app && act(() => api.disconnectApp(app.id), `${app.name} is disconnected.`)
          }
        />
      }
    >
      <section aria-labelledby="apps-h" className="mb-10">
        <div className="mb-3 flex items-baseline justify-between">
          <Eyebrow id="apps-h">Apps</Eyebrow>
          <span className={`${mono} text-[12px] text-muted`}>
            {connected} of {data.apps.length} connected
          </span>
        </div>
        <ul className="m-0 list-none border-t border-line p-0">
          {data.apps.map((a) => (
            <AppRow
              key={a.id}
              app={a}
              selected={current?.kind === 'app' && current.id === a.id}
              onManage={() => setSelected({ kind: 'app', id: a.id })}
              onSignIn={() => act(() => api.signInApp(a.id), `${a.name} is connected.`)}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="machines-h" className="mb-8">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <Eyebrow id="machines-h">Machines</Eyebrow>
          <span className={`${mono} text-right text-[12px] text-muted`}>
            Remy asks before every command
          </span>
        </div>
        <ul className="m-0 list-none border-t border-line p-0">
          {data.machines.map((m) => (
            <li
              key={m.name}
              className={`${row} ${current?.kind === 'machine' && current.name === m.name ? '-mx-3 rounded-[10px] border-transparent bg-surface px-3' : ''}`}
            >
              <span
                aria-hidden="true"
                className={`${mono} grid size-10 shrink-0 place-items-center rounded-md border border-stone text-[11px]`}
              >
                {'>_'}
              </span>
              <div className="min-w-[160px] flex-1">
                <h3 className={`${mono} m-0 text-[15px] font-medium`}>{m.name}</h3>
                <p className="m-0 mt-1 text-[14px] text-muted">{m.detail}</p>
              </div>
              <span className={`${mono} text-[12px] text-muted`}>
                {m.status === 'reachable'
                  ? 'Reachable'
                  : m.status === 'unchecked'
                    ? 'Not checked'
                    : 'Not reachable'}
              </span>
              <button
                type="button"
                className={quiet}
                aria-pressed={current?.kind === 'machine' && current.name === m.name}
                onClick={() => setSelected({ kind: 'machine', name: m.name })}
              >
                Manage {m.name}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-wrap gap-2">
        <a className={primary} href="#/connections/add">
          Add a connection
        </a>
        <a className={quiet} href="#/connections/machine">
          Add a machine
        </a>
      </div>
    </Page>
  );
}

function AppRow({
  app,
  selected,
  onManage,
  onSignIn,
}: {
  app: ConnectedApp;
  selected: boolean;
  onManage: () => void;
  onSignIn: () => void;
}) {
  const status = [STATUS[app.status], app.status === 'connected' && app.statusNote]
    .filter(Boolean)
    .join(' · ');
  return (
    <li
      className={`${row} ${selected ? '-mx-3 rounded-[10px] border-transparent bg-surface px-3' : ''}`}
      aria-current={selected ? 'true' : undefined}
    >
      <AppLogo id={app.id} />
      <div className="min-w-[160px] flex-1">
        <h3 className="m-0 text-[16px] font-medium">{app.name}</h3>
        <p className="m-0 mt-1 text-[14px] text-muted">{app.blurb}</p>
      </div>
      <span
        className={`${mono} text-[12px] ${app.status === 'connected' ? 'text-muted' : 'text-text'}`}
      >
        {status}
      </span>
      {app.status === 'connected' ? (
        <button type="button" className={quiet} aria-pressed={selected} onClick={onManage}>
          Manage {app.name.replace('Google ', '')}
        </button>
      ) : (
        <button
          type="button"
          className={app.status === 'needs_signin' ? primary : quiet}
          onClick={onSignIn}
        >
          {app.status === 'needs_signin' ? `Sign in to ${app.name}` : `Connect ${app.name}`}
        </button>
      )}
    </li>
  );
}

function Panel({
  app,
  machine,
  said,
  onToggle,
  onDisconnect,
}: {
  app: ConnectedApp | undefined;
  machine: Machine | undefined;
  said: string;
  onToggle: (permissionId: string, on: boolean) => void;
  onDisconnect: () => void;
}) {
  if (machine) {
    return (
      <div>
        <Eyebrow>{machine.name} · how Remy behaves</Eyebrow>
        <p className="mt-4 mb-0 text-[14px] text-muted">{machine.detail}</p>
        <p className="mt-4 mb-0 rounded-[10px] border border-line px-4 py-3 text-[14px] text-muted">
          Every command asks you first and is shown in full. Output from the machine is treated as
          untrusted text, not orders.
        </p>
        <Notice>{said}</Notice>
      </div>
    );
  }
  if (!app)
    return <p className="m-0 text-[14px] text-muted">Pick a connection to see its rules.</p>;
  if (app.status !== 'connected') {
    return (
      <div>
        <Eyebrow>{app.name} · what Remy may do</Eyebrow>
        <p className="mt-4 text-[14px] text-muted">
          {app.status === 'needs_signin'
            ? `Sign in to ${app.name} to choose what Remy may do.`
            : `Connect ${app.name} to choose what Remy may do.`}
        </p>
        <Notice>{said}</Notice>
      </div>
    );
  }
  return (
    <div>
      <Eyebrow>{app.name} · what Remy may do</Eyebrow>
      <ul className="m-0 mt-3 list-none p-0">
        {app.permissions.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between gap-4 border-b border-line py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="m-0 text-[15px] font-medium">{p.label}</p>
              <p className="m-0 mt-0.5 text-[13px] text-muted">{p.detail}</p>
            </div>
            <Switch checked={p.on} label={p.label} onChange={(on) => onToggle(p.id, on)} />
          </li>
        ))}
      </ul>
      <p className="mt-4 mb-4 rounded-[10px] border border-line px-4 py-3 text-[14px] leading-relaxed text-muted">
        {app.untrusted}
      </p>
      <button type="button" className={quiet} onClick={onDisconnect}>
        Disconnect {app.name.replace('Google ', '')}
      </button>
      <div className="mt-3">
        <Notice>{said}</Notice>
      </div>
    </div>
  );
}
