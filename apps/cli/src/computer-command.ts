// `remy computer list|add|test|rm`: the machines Remy may run commands on (a container Remy owns,
// a container that already runs, or a server over ssh). Saved in remy.config.json. `test` runs
// `uname -a` there without a model or an approval card, because the person typed the command.
import {
  BOAT_SIZES,
  type BoatConfig,
  type BoatDeps,
  type BoatSize,
  type Computer,
  type ComputerConfig,
  computerFromConfig,
  type DockerConfig,
  describeComputer,
  type Exec,
  type SshConfig,
} from '@remy/tools';
import { writeComputers } from './serve-connect.ts';

export interface ComputerCommandContext {
  rest: string[];
  flags: {
    docker?: string | undefined;
    container?: string | undefined;
    ssh?: string | undefined;
    key?: string | undefined;
    network?: string | undefined;
    boat?: boolean | undefined;
    size?: string | undefined;
    region?: string | undefined;
  };
  /** How a Boat computer reads the person's own key. */
  boat?: BoatDeps | undefined;
  /** The `computers` of the config file Remy reads. */
  list: () => ComputerConfig[];
  /** The file `add` and `rm` write. */
  configPath: string;
  out: (text: string) => void;
  /** Overrides the process runner (tests). */
  exec?: Exec;
  /** Overrides the provider (tests). */
  make?: (cfg: ComputerConfig) => Computer;
}

const USAGE = `Usage:
  remy computer list
  remy computer add <name> --docker <image> [--network none]
  remy computer add <name> --container <running-container>
  remy computer add <name> --ssh user@host[:port] [--key <path>]
  remy computer add <name> --boat [--size small|default|large|xlarge]   (your own Boat key)
  remy computer test <name>
  remy computer rm <name>`;

/** user@host[:port] into its parts, or null. */
export function parseSshTarget(v: string): Pick<SshConfig, 'user' | 'host' | 'port'> | null {
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)@([A-Za-z0-9][A-Za-z0-9._-]*)(?::(\d{1,5}))?$/.exec(v);
  if (!m?.[1] || !m[2]) return null;
  const port = m[3] ? Number(m[3]) : undefined;
  if (port !== undefined && !(port > 0 && port < 65536)) return null;
  return { user: m[1], host: m[2], ...(port !== undefined && { port }) };
}

export async function computerCommand(c: ComputerCommandContext): Promise<number> {
  const [sub, name, ...extra] = c.rest;
  const make =
    c.make ??
    ((cfg: ComputerConfig) =>
      computerFromConfig(cfg, c.exec, c.boat ?? { getKey: async () => undefined }));
  const list = c.list();
  const find = (n: string | undefined) => {
    if (!n) throw new Error(USAGE);
    const hit = list.find((x) => x.name === n);
    if (!hit)
      throw new Error(
        `There is no machine named ${n}. ${list.length ? `You have: ${list.map((x) => x.name).join(', ')}.` : 'Add one with remy computer add.'}`,
      );
    return hit;
  };
  if (extra.length) throw new Error(USAGE);

  switch (sub) {
    case undefined:
    case 'list': {
      if (!list.length) {
        c.out(
          'No machines yet. Add one with remy computer add <name> --docker debian:stable-slim.\n',
        );
        return 0;
      }
      for (const m of list) c.out(`${m.name}: ${make(m).where}\n`);
      return 0;
    }
    case 'add': {
      if (!name) throw new Error(USAGE);
      const { docker, container, ssh, key, network, boat, size, region } = c.flags;
      const kinds = [docker, container, ssh, boat ? true : undefined].filter(
        (v) => v !== undefined,
      ).length;
      if (kinds !== 1)
        throw new Error(`Choose one of --docker, --container, --ssh or --boat.\n${USAGE}`);
      if (region !== undefined)
        throw new Error('Boat has no region setting: it runs in EU regions only.');
      if (size !== undefined && !boat) throw new Error('--size goes with --boat.');
      if (list.some((x) => x.name === name))
        throw new Error(
          `There is already a machine named ${name}. Remove it first with remy computer rm ${name}.`,
        );
      if (key !== undefined && ssh === undefined) throw new Error('--key goes with --ssh.');
      if (network !== undefined && docker === undefined)
        throw new Error('--network goes with --docker.');
      let cfg: ComputerConfig;
      if (boat) {
        if (size !== undefined && !(BOAT_SIZES as readonly string[]).includes(size))
          throw new Error(`--size is one of ${BOAT_SIZES.join(', ')}.`);
        const b: BoatConfig = {
          kind: 'boat',
          name,
          ...(size !== undefined && { size: size as BoatSize }),
        };
        cfg = b;
      } else if (ssh !== undefined) {
        const t = parseSshTarget(ssh);
        if (!t) throw new Error(`"${ssh}" is not user@host or user@host:port.`);
        cfg = { name, ...t, ...(key !== undefined && { keyPath: key }) };
      } else {
        if (network !== undefined && network !== 'bridge' && network !== 'none')
          throw new Error('--network is bridge or none.');
        const d: DockerConfig =
          docker !== undefined
            ? {
                kind: 'docker',
                name,
                image: docker,
                ...(network && { network: network as 'bridge' | 'none' }),
              }
            : { kind: 'docker', name, container: container as string };
        cfg = d;
      }
      // Building the provider checks the name, image, container, host and key path.
      const where = make(cfg).where;
      writeComputers(c.configPath, [...list, cfg]);
      c.out(`Added ${name}: ${where}. Check it with remy computer test ${name}.\n`);
      if (boat)
        c.out(
          'It uses your own Boat key (remy search key boat, or BOAT_API_KEY). Boat costs money after its 7-day trial; Remy has no Boat account and adds nothing to your bill.\n',
        );
      return 0;
    }
    case 'test': {
      const cfg = find(name);
      const m = make(cfg);
      c.out(`Testing ${m.name} (${m.where}).\n`);
      const r = await m.run('uname -a', { timeoutMs: 300_000 });
      if (r.timedOut) throw new Error(`${m.name} did not answer in time.`);
      if (r.exitCode !== 0) {
        c.out(`${m.name} answered with exit code ${r.exitCode}.\n`);
        const e = r.stderr.trim();
        if (e) c.out(`${e}\n`);
        return 1;
      }
      c.out(`${r.stdout.trim()}\n${m.name} works.\n`);
      return 0;
    }
    case 'rm': {
      const cfg = find(name);
      writeComputers(
        c.configPath,
        list.filter((x) => x.name !== cfg.name),
      );
      const owned = cfg.kind === 'docker' && cfg.image !== undefined;
      if (cfg.kind === 'boat')
        c.out(
          `Removing ${cfg.name} from Remy does not delete the Boat computer. It stops by itself when idle; delete it at boat.dev to stop all charges.\n`,
        );
      c.out(
        `Removed ${cfg.name} (${describeComputer(cfg)}).${owned ? ` Its container stays until you run docker rm -f remy-computer-${cfg.name}.` : ''}\n`,
      );
      return 0;
    }
    default:
      throw new Error(USAGE);
  }
}
