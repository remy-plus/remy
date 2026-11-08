// Which reach profile suits this machine (PLAN.md, "Reach depends on the machine"). Pure: the
// facts come from reach-facts.ts, so every rule can be tested.
import type { ReachFacts } from './reach-facts.ts';

export type ReachProfile = 'light' | 'strong' | 'home-server';

export interface ReachAdvice {
  profile: ReachProfile;
  /** What Remy uses for real apps and search on this machine. */
  uses: string;
  reason: string;
  /** The one thing to do next. */
  step: string;
}

/** Below this the container is not worth its memory or its images. */
export const STRONG_MEMORY_GB = 16;
export const MIN_DISK_GB = 10;
const LIGHT_MEMORY_GB = 8;

/** Not installed and never set up for you. */
export const OPT_IN_LINE =
  'Opt-in, not installed: terminal-mac (a power-user Mac) and Boat (a cloud computer on your own account).';

const gb = (n: number) => `${Math.round(n)} GB`;

export function recommendReach(f: ReachFacts): ReachAdvice {
  const lowDisk = f.freeDiskGb !== undefined && f.freeDiskGb < MIN_DISK_GB;
  const fine = f.memoryGb >= STRONG_MEMORY_GB && !lowDisk;
  const ram = `${gb(f.memoryGb)} of memory`;

  // A server with no desktop browser: the container image is the route, and it ships in Stage 6.
  if (f.platform === 'linux' && !f.browser && fine) {
    return {
      profile: 'home-server',
      uses: 'a container',
      reason: `${ram} and no desktop browser, which suits a home server.`,
      step: f.dockerRunning
        ? 'Run remy browser vm start for search. The ready-made Docker image for a server comes in Stage 6.'
        : 'Install Docker, then run remy browser vm start. The ready-made Docker image for a server comes in Stage 6.',
    };
  }

  if (fine && f.dockerRunning) {
    return {
      profile: 'strong',
      uses: 'a container',
      reason: `${ram}, ${f.freeDiskGb === undefined ? 'enough disk' : `${gb(f.freeDiskGb)} free`} and Docker running.`,
      step: 'Run remy browser vm start.',
    };
  }

  const keyed = f.keySearch;
  const light = (reason: string, step: string): ReachAdvice => ({
    profile: 'light',
    uses:
      f.dockerRunning && !lowDisk
        ? 'the hidden browser, or a small container'
        : 'the hidden browser',
    reason,
    step,
  });

  if (lowDisk)
    return light(
      `Only ${gb(f.freeDiskGb as number)} free where Remy keeps its data.`,
      `Free up about ${gb(MIN_DISK_GB - (f.freeDiskGb as number))} before using a container.`,
    );
  if (!f.browser && !keyed)
    return light(
      'No Chrome or Edge found and no search key set.',
      'Install Chrome, or set TINYFISH_API_KEY for search that needs no browser.',
    );
  if (f.memoryGb >= STRONG_MEMORY_GB)
    return light(
      `${ram}, but Docker is not running.`,
      'Install or start Docker (or Colima) for the container route.',
    );
  if (f.memoryGb < LIGHT_MEMORY_GB)
    return light(
      `${ram}, which is tight for anything beyond the hidden browser.`,
      keyed ? 'Nothing to change.' : 'Set TINYFISH_API_KEY so search needs no browser.',
    );
  return light(
    `${ram}${f.dockerRunning ? ', which is modest for a container' : ''}.`,
    keyed
      ? 'Nothing to change; search already uses a service with your key.'
      : 'Set TINYFISH_API_KEY for steadier search, or stay on the hidden browser.',
  );
}

/** The lines `remy doctor` prints for the advice. */
export function reachLines(a: ReachAdvice): string[] {
  return [
    `Reach: ${a.profile}. Uses ${a.uses}. ${a.reason}`,
    `  Next: ${a.step}`,
    `  ${OPT_IN_LINE}`,
  ];
}
