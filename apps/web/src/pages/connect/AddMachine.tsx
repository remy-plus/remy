import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { type MachineInput, type MachineTest, useApi } from '../../api/index.tsx';
import { Eyebrow, field, mono, Notice, Page, primary, quiet } from './ui.tsx';

// The same rule as `sshComputer` in packages/tools/src/computer.ts: a value that starts with "-"
// would be read by ssh as an option, and anything outside these characters is refused.
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const NAME_RULE =
  'Use letters, numbers, dots, dashes or underscores. No spaces, and it cannot start with a dash.';

export type MachineErrors = Partial<Record<'name' | 'host' | 'port' | 'user' | 'keyPath', string>>;

export function validateMachine(v: {
  name: string;
  host: string;
  port: string;
  user: string;
  keyPath: string;
}): MachineErrors {
  const errors: MachineErrors = {};
  const check = (k: 'name' | 'host' | 'user', label: string) => {
    const value = v[k].trim();
    if (!value) errors[k] = `Enter ${label}.`;
    else if (!SAFE_NAME.test(value) || value.startsWith('-')) errors[k] = NAME_RULE;
  };
  check('name', 'a name');
  check('host', 'an address');
  check('user', 'a user');
  const port = Number(v.port);
  if (!/^\d+$/.test(v.port.trim()) || !(port > 0 && port < 65536))
    errors.port = 'Use a number from 1 to 65535.';
  if (v.keyPath.trim().startsWith('-')) errors.keyPath = 'A key path cannot start with a dash.';
  return errors;
}

const RULES = [
  'Every command asks you first and is shown in full.',
  'A command is never repeated if it may already have run.',
  'Output from the machine is treated as untrusted text, not orders.',
  'Remove the machine here and Remy loses access at once.',
];

function Field({
  id,
  label,
  error,
  hint,
  children,
  className = '',
}: {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className={`${mono} mb-2 block text-[12px] text-muted`}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="mt-2 mb-0 text-[13px] text-[#d98b7a]">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-msg`} className="mt-2 mb-0 text-[13px] text-muted">
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function AddMachine() {
  const api = useApi();
  const uid = useId();
  const [v, setV] = useState({
    name: 'home-server',
    host: '10.0.0.5',
    port: '22',
    user: 'remy',
    keyMode: 'own' as 'own' | 'file',
    keyPath: '',
  });
  const [errors, setErrors] = useState<MachineErrors>({});
  const [test, setTest] = useState<MachineTest | 'running' | null>(null);
  const [problem, setProblem] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((x) => ({ ...x, [k]: e.target.value }));

  const input = (): MachineInput => ({
    name: v.name.trim(),
    host: v.host.trim(),
    port: Number(v.port),
    user: v.user.trim(),
    keyPath: v.keyMode === 'file' ? v.keyPath.trim() : '',
  });
  const valid = () => {
    const found = validateMachine({ ...v, keyPath: v.keyMode === 'file' ? v.keyPath : '' });
    setErrors(found);
    return Object.keys(found).length === 0;
  };
  const props = (k: keyof MachineErrors) => ({
    id: `${uid}-${k}`,
    'aria-invalid': errors[k] ? (true as const) : undefined,
    'aria-describedby': errors[k] || k === 'user' ? `${uid}-${k}-msg` : undefined,
    className: `${field} ${mono} text-[14px]`,
  });

  const runTest = async () => {
    setProblem('');
    if (!valid()) return;
    setTest('running');
    try {
      setTest(await api.testMachine(input()));
    } catch (e) {
      setTest(null);
      setProblem(e instanceof Error ? e.message : 'The test did not run.');
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem('');
    if (!valid()) return;
    try {
      await api.addMachine(input());
      window.location.hash = '#/connections';
    } catch (err) {
      setProblem(
        err instanceof Error
          ? err.message
          : 'That did not work. Check that Remy is still running, then try again.',
      );
    }
  };

  return (
    <Page
      crumb="Add a machine"
      title="Give Remy a computer."
      lead="A server, a VPS or any machine you can reach over ssh. Remy runs commands there with your key, and asks before each one."
      aside={
        <div>
          <Eyebrow>Test result</Eyebrow>
          <div
            role="status"
            className={`mt-3 mb-8 rounded-[10px] border bg-surface px-4 py-3 text-[13px] ${test && test !== 'running' && test.ok ? 'border-signal' : 'border-edge'}`}
          >
            {test === null && <p className="m-0 text-muted">Not tested yet.</p>}
            {test === 'running' && <p className="m-0 text-muted">Testing</p>}
            {test && test !== 'running' && (
              <ul className={`${mono} m-0 list-none p-0 leading-7`}>
                {test.lines.map((l, i) => (
                  <li key={l} className={i === 0 ? 'text-text' : 'text-muted'}>
                    {i === 0 && (
                      <span
                        aria-hidden="true"
                        className={`mr-2 inline-block size-1.5 rounded-full ${test.ok ? 'bg-signal' : 'bg-[#d98b7a]'}`}
                      />
                    )}
                    {l}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Eyebrow>How Remy behaves here</Eyebrow>
          <ol className="m-0 mt-3 list-none p-0">
            {RULES.map((r, i) => (
              <li key={r} className="flex gap-4 py-2 text-[15px] leading-relaxed">
                <span className={`${mono} pt-0.5 text-[12px] text-muted`}>
                  {String(i + 1).padStart(2, '0')}
                </span>
                {r}
              </li>
            ))}
          </ol>
        </div>
      }
    >
      <form
        onSubmit={submit}
        noValidate
        aria-label="Add a machine"
        className="grid max-w-[560px] gap-5"
      >
        <Field id={`${uid}-name`} label="Name" error={errors.name}>
          <input {...props('name')} value={v.name} onChange={set('name')} autoComplete="off" />
        </Field>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-x-3">
          <Field id={`${uid}-host`} label="Address" error={errors.host}>
            <input {...props('host')} value={v.host} onChange={set('host')} autoComplete="off" />
          </Field>
          <Field id={`${uid}-port`} label="Port" error={errors.port}>
            <input
              {...props('port')}
              value={v.port}
              onChange={set('port')}
              inputMode="numeric"
              autoComplete="off"
            />
          </Field>
        </div>
        <Field
          id={`${uid}-user`}
          label="User"
          error={errors.user}
          hint="Use a user that is not root."
        >
          <input {...props('user')} value={v.user} onChange={set('user')} autoComplete="off" />
        </Field>
        <Field
          id={`${uid}-key`}
          label="Key"
          hint="Remy makes a key just for this machine. You add its public half to the server. It never leaves this device."
        >
          <select
            id={`${uid}-key`}
            className={`${field} ${mono} text-[14px]`}
            value={v.keyMode}
            onChange={(e) => setV((x) => ({ ...x, keyMode: e.target.value as 'own' | 'file' }))}
          >
            <option value="own">Remy’s key, in your keychain</option>
            <option value="file">A key file I choose</option>
          </select>
          {v.keyMode === 'file' && (
            <div className="mt-3">
              <label htmlFor={`${uid}-keyPath`} className="sr-only">
                Key file path
              </label>
              <input
                {...props('keyPath')}
                placeholder="~/.ssh/id_ed25519"
                value={v.keyPath}
                onChange={set('keyPath')}
                autoComplete="off"
              />
              {errors.keyPath && (
                <p id={`${uid}-keyPath-msg`} className="mt-2 mb-0 text-[13px] text-[#d98b7a]">
                  {errors.keyPath}
                </p>
              )}
            </div>
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={quiet} onClick={runTest}>
            Test the connection
          </button>
          <button type="submit" className={primary}>
            Add {v.name.trim() || 'machine'}
          </button>
          <a href="#/connections" className={quiet}>
            Cancel
          </a>
        </div>
        <Notice>{problem}</Notice>
      </form>
    </Page>
  );
}
