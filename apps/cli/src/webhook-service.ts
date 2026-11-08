// Puts the pieces together for `remy webhook start` and the daemon: the saved hooks, the shared
// token, the bind check, and a way to start a run in a separate process with the payload on stdin
// (never on a command line, where other users of the machine could read it).
import { execFile } from 'node:child_process';
import type { EntryPoint } from './background.ts';
import { type Bind, resolveBind } from './webhook-bind.ts';
import { type Listening, listenWebhook } from './webhook-server.ts';
import { type Hook, openHooks } from './webhook-store.ts';
import { sharedToken } from './webhook-token.ts';

export type HookStarter = (hook: Hook, payload: string) => Promise<string>;

/** Starts `remy webhook run <name>` with the payload on stdin; resolves to the new task id. */
export function processStarter(p: {
  entry: EntryPoint;
  env: Record<string, string | undefined>;
  cwd: string;
}): HookStarter {
  return (hook, payload) =>
    new Promise<string>((done, fail) => {
      const child = execFile(
        p.entry.execPath,
        [...p.entry.execArgv, p.entry.script, 'webhook', 'run', hook.name],
        { env: p.env, cwd: p.cwd, timeout: 60_000 },
        (e, stdout) => {
          if (e) return fail(new Error('the run did not start'));
          const id = /task_[a-f0-9]+/.exec(stdout)?.[0];
          if (id) done(id);
          else fail(new Error('the run did not start'));
        },
      );
      child.stdin?.on('error', () => {});
      child.stdin?.end(payload);
    });
}

/** Whether webhooks should listen: switched on, and at least one hook saved. */
export function shouldListen(home: string): boolean {
  const hooks = openHooks(home);
  return hooks.enabled() && hooks.list().length > 0;
}

export async function startWebhooks(p: {
  home: string;
  env: Record<string, string | undefined>;
  bind?: string;
  port?: string;
  start: HookStarter;
  isActive: (runId: string) => Promise<boolean>;
  log: (line: string) => void;
}): Promise<Listening> {
  const bind: Bind = resolveBind({ bind: p.bind, port: p.port }, p.env);
  const hooks = openHooks(p.home);
  return listenWebhook(
    {
      hook: (name) => hooks.get(name),
      sharedToken: () => sharedToken(p.home),
      start: p.start,
      isActive: p.isActive,
      log: p.log,
    },
    bind,
  );
}

/** The daemon's part: listens only when webhooks are on and a hook exists. A failure to bind is logged, never fatal. */
export async function daemonWebhooks(
  p: Parameters<typeof startWebhooks>[0],
): Promise<Listening | undefined> {
  if (!shouldListen(p.home)) return undefined;
  try {
    const listening = await startWebhooks(p);
    p.log(`Webhooks listen on http://${listening.host}:${listening.port}/hook/<name>.`);
    return listening;
  } catch (e) {
    p.log(`Webhooks did not start: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}
