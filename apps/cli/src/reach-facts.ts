// What this machine can tell us for `remy doctor`'s reach advice. Every read is cheap; Docker is
// asked only with a short timeout, and anything that fails reads as "no".
import { spawnSync } from 'node:child_process';
import { existsSync, statfsSync } from 'node:fs';
import { arch, availableParallelism, platform, totalmem } from 'node:os';
import { dirname } from 'node:path';

export interface ReachFacts {
  platform: string;
  arch: string;
  cores: number;
  memoryGb: number;
  /** Free space where Remy keeps its data, in GB; undefined when it cannot be read. */
  freeDiskGb?: number;
  dockerRunning: boolean;
  /** Chrome, Edge or Chromium is installed. */
  browser: boolean;
  /** A search service with a key is set up (not the hidden browser or the container). */
  keySearch: boolean;
}

const GB = 1024 ** 3;

/** Free space at `path`, or at its nearest folder that exists. */
export function freeDiskGb(
  path: string,
  stat: (p: string) => { bavail: number | bigint; bsize: number | bigint } = statfsSync,
  exists: (p: string) => boolean = existsSync,
): number | undefined {
  let at = path;
  while (!exists(at)) {
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
  try {
    const s = stat(at);
    return (Number(s.bavail) * Number(s.bsize)) / GB;
  } catch {
    return undefined;
  }
}

export interface ReachProbes {
  home: string;
  browser: boolean;
  keySearch: boolean;
  /** Replaced in tests. */
  docker?: () => boolean;
  memoryBytes?: () => number;
  platform?: string;
  arch?: string;
  cores?: () => number;
  freeDisk?: (home: string) => number | undefined;
}

export function readReachFacts(p: ReachProbes): ReachFacts {
  const docker = p.docker ?? (() => spawnSync('docker', ['info'], { timeout: 3000 }).status === 0);
  const free = (p.freeDisk ?? freeDiskGb)(p.home);
  return {
    platform: p.platform ?? platform(),
    arch: p.arch ?? arch(),
    cores: (p.cores ?? availableParallelism)(),
    memoryGb: (p.memoryBytes ?? totalmem)() / GB,
    ...(free !== undefined && { freeDiskGb: free }),
    dockerRunning: docker(),
    browser: p.browser,
    keySearch: p.keySearch,
  };
}
