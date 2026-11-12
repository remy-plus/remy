import { useState } from 'react';
import type { ConnectedApp, Machine } from '../../api/index.tsx';
import { Confirm } from '../../components/Confirm.tsx';
import { describeError } from '../../lib/errors.ts';
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

/** A change, said beside the thing it changed: the row that acted, or the panel that did. */
type Said = { text: string; at: 'row' | 'panel' | 'machines'; id: string };

const STATUS: Record<ConnectedApp['status'], string> = {
  connected: 'Connected',
  needs_signin: 'Needs sign-in',
  not_connected: 'Not connected',
};

const FALLBACK = 'That did not work. Check that Remy is still running, then try again.';
const row = 'flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-edge py-4';
const empty = 'rounded-[10px] border border-edge bg-surface px-4 py-5';

export function Connections() {
  const { api, data, setData, error, reload } = useLoad((a) => a.connections());
  const [selected, setSelected] = useState<Selected | null>(null);
  const [said, setSaid] = useState<Said | null>(null);
  const [asking, setAsking] = useState<Selected | null>(null);
  if (error) return <Unavailable message={error} onRetry={reload} />;
  if (!data) return <Loading label="Loading your connections" />;

  const first = data.apps.find((a) => a.status === 'connected') ?? data.apps[0];
  const current: Selected | null = selected ?? (first ? { kind: 'app', id: first.id } : null);
  const app = current?.kind === 'app' ? data.apps.find((a) => a.id === current.id) : undefined;
  const machine =
    current?.kind === 'machine' ? data.machines.find((m) => m.name === current.name) : undefined;

  const refresh = async () => setData(await api.connections());
  const act = async (fn: () => Promise<void>, line: string, at: Said['at'], id: string) => {
    try {
      await fn();
      await refresh();
      setSaid({ text: line, at, id });
    } catch (e) {
      setSaid({ text: describeError(e, FALLBACK), at, id });
    }
  };
  const saidAt = (at: Said['at'], id: string | undefined) =>
    said && said.at === at && said.id === id ? said.text : undefined;
  const askedApp = asking?.kind === 'app' ? data.apps.find((a) => a.id === asking.id) : undefined;
  const askTitle =
    asking?.kind === 'machine'
      ? `Remove ${asking.name}?`
      : `Disconnect ${askedApp?.name ?? 'this app'}?`;
  const connected = data.apps.filter((a) => a.status === 'connected').length;

  return (
    <Page
      title="Connections"
      lead="What Remy can reach. It asks before it sends anything as you or spends money."
      aside={
        <Panel
          app={app}
          machine={machine}
          hasMachines={data.machines.length > 0}
          said={saidAt('panel', app?.id ?? machine?.name)}
          onToggle={(permId, on) =>
            app &&
            act(
              () => api.setPermission(app.id, permId, on),
              // The server writes the change to the config; the running app keeps its old tools.
              `${app.name}: ${app.permissions.find((p) => p.id === permId)?.label} is ${on ? 'on' : 'off'}. It applies the next time Remy starts.`,
              'panel',
              app.id,
            )
          }
          onDisconnect={() => app && setAsking({ kind: 'app', id: app.id })}
          onRemove={() => machine && setAsking({ kind: 'machine', name: machine.name })}
        />
      }
    >
      <Confirm
        open={asking !== null}
        title={askTitle}
        confirmLabel={asking?.kind === 'machine' ? 'Remove' : 'Disconnect'}
        cancelLabel="Keep it"
        onConfirm={async () => {
          if (!asking) return;
          if (asking.kind === 'app' && askedApp) {
            // Keep the panel on the app that changed, so the sentence lands where the button was.
            setSelected({ kind: 'app', id: askedApp.id });
            await act(
              () => api.disconnectApp(askedApp.id),
              `${askedApp.name} is disconnected.`,
              'panel',
              askedApp.id,
            );
          } else if (asking.kind === 'machine') {
            const name = asking.name;
            setSelected(null);
            await act(() => api.removeMachine(name), `${name} is removed.`, 'machines', '');
          }
          setAsking(null);
        }}
        onCancel={() => setAsking(null)}
      >
        {asking?.kind === 'machine'
          ? 'Remy will stop using this machine. Its settings on that machine are not touched.'
          : `Remy will stop using ${askedApp?.name ?? 'this app'} right away. You can connect it again later.`}
      </Confirm>

      <section aria-labelledby="apps-h" className="mb-10">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <Eyebrow id="apps-h">Apps</Eyebrow>
          {data.apps.length > 0 && (
            <span className={`${mono} text-[12px] text-muted`}>
              {connected} of {data.apps.length} connected
            </span>
          )}
        </div>
        {data.apps.length === 0 ? (
          <div className={empty}>
            <p className="m-0 text-[15px]">No app is connected yet.</p>
            <p className="mt-1 mb-4 max-w-[520px] text-[14px] leading-relaxed text-muted">
              A connection lets Remy read, draft or act in an app for you. It asks before anything
              is sent as you.
            </p>
            <a className={primary} href="#/connections/add">
              Connect an app
            </a>
          </div>
        ) : (
          <ul className="m-0 list-none border-t border-edge p-0">
            {data.apps.map((a) => (
              <AppRow
                key={a.id}
                app={a}
                selected={current?.kind === 'app' && current.id === a.id}
                said={saidAt('row', a.id)}
                onManage={() => setSelected({ kind: 'app', id: a.id })}
                onSignIn={() =>
                  act(() => api.signInApp(a.id), `${a.name} is connected.`, 'row', a.id)
                }
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="machines-h" className="mb-8">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <Eyebrow id="machines-h">Machines</Eyebrow>
          {data.machines.length > 0 && (
            <span className={`${mono} text-[12px] text-muted`}>{data.machines.length}</span>
          )}
        </div>
        <p className="mt-0 mb-3 max-w-[560px] text-[14px] leading-relaxed text-muted">
          A machine is a computer Remy can run commands on, with your key. It asks before each one.
        </p>
        {saidAt('machines', '') && (
          <p role="status" className="mt-0 mb-3 text-[13px] text-text">
            {saidAt('machines', '')}
          </p>
        )}
        {data.machines.length === 0 ? (
          <div className={empty}>
            <p className="m-0 text-[15px]">No machine is added yet.</p>
            <p className="mt-1 mb-4 max-w-[520px] text-[14px] leading-relaxed text-muted">
              Add a server or another computer and Remy can work there, asking before every command.
            </p>
            <a className={primary} href="#/connections/machine">
              Add a machine
            </a>
          </div>
        ) : (
          <ul className="m-0 list-none border-t border-edge p-0">
            {data.machines.map((m) => (
              <li
                key={m.name}
                className={`${row} ${current?.kind === 'machine' && current.name === m.name ? '-mx-3 rounded-[10px] border-transparent bg-surface px-3' : ''}`}
              >
                <div className="min-w-[160px] flex-1">
                  <h3 className={`${mono} m-0 text-[15px] font-medium`}>{m.name}</h3>
                  <p className="m-0 mt-1 text-[14px] break-words text-muted">{m.detail}</p>
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
        )}
      </section>

      {(data.apps.length > 0 || data.machines.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {data.apps.length > 0 && (
            <a className={primary} href="#/connections/add">
              Connect an app
            </a>
          )}
          {data.machines.length > 0 && (
            <a className={quiet} href="#/connections/machine">
              Add a machine
            </a>
          )}
        </div>
      )}
    </Page>
  );
}

function AppRow({
  app,
  selected,
  said,
  onManage,
  onSignIn,
}: {
  app: ConnectedApp;
  selected: boolean;
  said: string | undefined;
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
      <AppLogo id={app.id} name={app.name} />
      <div className="min-w-[160px] flex-1">
        <h3 className="m-0 text-[16px] font-medium">{app.name}</h3>
        <p className="m-0 mt-1 text-[14px] text-muted">{app.blurb}</p>
        {said && (
          <p role="status" className="m-0 mt-1 text-[13px] text-text">
            {said}
          </p>
        )}
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
  hasMachines,
  said,
  onToggle,
  onDisconnect,
  onRemove,
}: {
  app: ConnectedApp | undefined;
  machine: Machine | undefined;
  hasMachines: boolean;
  said: string | undefined;
  onToggle: (permissionId: string, on: boolean) => void;
  onDisconnect: () => void;
  onRemove: () => void;
}) {
  if (machine) {
    return (
      <div>
        <Eyebrow>{machine.name} · how Remy behaves</Eyebrow>
        <p className="mt-4 mb-0 text-[14px] break-words text-muted">{machine.detail}</p>
        <p className="mt-4 mb-0 rounded-[10px] border border-edge px-4 py-3 text-[14px] leading-relaxed text-muted">
          Every command asks you first and is shown in full. Anything the machine sends back is read
          as information, never as instructions.
        </p>
        <div className="mt-4">
          <button type="button" className={quiet} onClick={onRemove}>
            Remove this machine
          </button>
        </div>
        <div className="mt-3">
          <Notice>{said}</Notice>
        </div>
      </div>
    );
  }
  if (!app)
    return (
      <p className="m-0 text-[14px] text-muted">
        {hasMachines
          ? 'Pick a machine to see how Remy behaves there.'
          : 'Nothing is connected yet. Connect an app and its rules appear here.'}
      </p>
    );
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
            className="flex items-center justify-between gap-4 border-b border-edge py-3 last:border-b-0"
          >
            <div className="min-w-0">
              <p className="m-0 text-[15px] font-medium">{p.label}</p>
              <p className="m-0 mt-0.5 text-[13px] text-muted">{p.detail}</p>
            </div>
            <Switch checked={p.on} label={p.label} onChange={(on) => onToggle(p.id, on)} />
          </li>
        ))}
      </ul>
      <p className="mt-4 mb-4 rounded-[10px] border border-edge px-4 py-3 text-[14px] leading-relaxed text-muted">
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
