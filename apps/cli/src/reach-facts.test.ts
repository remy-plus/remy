import { describe, expect, it } from 'vitest';
import { freeDiskGb, readReachFacts } from './reach-facts.ts';

const GB = 1024 ** 3;

describe('freeDiskGb', () => {
  it('reads the nearest folder that exists', () => {
    const asked: string[] = [];
    const gb = freeDiskGb(
      '/a/b/c',
      (p) => {
        asked.push(p);
        return { bavail: 20, bsize: GB };
      },
      (p) => p === '/a',
    );
    expect(gb).toBe(20);
    expect(asked).toEqual(['/a']);
  });

  it('is undefined when nothing exists or the read fails', () => {
    expect(
      freeDiskGb(
        '/x',
        () => ({ bavail: 1, bsize: 1 }),
        () => false,
      ),
    ).toBeUndefined();
    expect(
      freeDiskGb(
        '/x',
        () => {
          throw new Error('no');
        },
        () => true,
      ),
    ).toBeUndefined();
  });
});

describe('readReachFacts', () => {
  it('collects the facts from the probes', () => {
    const f = readReachFacts({
      home: '/h',
      browser: true,
      keySearch: false,
      docker: () => true,
      memoryBytes: () => 16 * GB,
      platform: 'darwin',
      arch: 'arm64',
      cores: () => 10,
      freeDisk: () => 120,
    });
    expect(f).toEqual({
      platform: 'darwin',
      arch: 'arm64',
      cores: 10,
      memoryGb: 16,
      freeDiskGb: 120,
      dockerRunning: true,
      browser: true,
      keySearch: false,
    });
  });

  it('leaves out disk space it cannot read', () => {
    const f = readReachFacts({
      home: '/h',
      browser: false,
      keySearch: false,
      docker: () => false,
      freeDisk: () => undefined,
    });
    expect('freeDiskGb' in f).toBe(false);
  });
});
