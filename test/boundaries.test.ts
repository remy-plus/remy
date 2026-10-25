// Package boundaries from PLAN.md: `core` depends on no other Remy package,
// and every other dependency edge must be declared here on purpose.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ALLOWED: Record<string, string[]> = {
  'packages/core': [],
  'packages/models': ['core'],
  'packages/tools': ['core'],
  'packages/store': ['core'],
  'packages/evals': ['core', 'models', 'tools', 'store'],
  'apps/cli': ['core', 'models', 'tools', 'store', 'evals'],
};

// Third-party runtime dependencies `core` may use. Everything else goes behind a port.
const CORE_THIRD_PARTY = ['zod'];

interface PackageJson {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as T;

const remyDeps = (pkg: PackageJson) =>
  Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter((d) => d.startsWith('@remy/'))
    .map((d) => d.slice('@remy/'.length))
    .sort();

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const IMPORT =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const importsOf = (file: string) =>
  [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((m) => (m[1] ?? m[2]) as string);

describe('package boundaries', () => {
  it('every workspace package is listed in ALLOWED', () => {
    const found = ['packages', 'apps'].flatMap((top) =>
      readdirSync(join(ROOT, top)).map((name) => `${top}/${name}`),
    );
    expect(found.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  for (const [dir, allowed] of Object.entries(ALLOWED)) {
    describe(dir, () => {
      const pkg = readJson<PackageJson>(`${dir}/package.json`);

      it('declares only allowed @remy dependencies', () => {
        for (const dep of remyDeps(pkg)) expect(allowed, `${dir} -> ${dep}`).toContain(dep);
      });

      it('tsconfig references match its @remy dependencies', () => {
        const tsconfig = readJson<{ references?: { path: string }[] }>(`${dir}/tsconfig.json`);
        const refs = (tsconfig.references ?? []).map((r) => r.path.split('/').pop()).sort();
        expect(refs).toEqual(remyDeps(pkg));
      });

      it('source imports stay inside the package or its declared dependencies', () => {
        const pkgRoot = join(ROOT, dir);
        const declared = remyDeps(pkg);
        for (const file of sourceFiles(join(pkgRoot, 'src'))) {
          const where = relative(ROOT, file);
          for (const spec of importsOf(file)) {
            if (spec.startsWith('@remy/')) {
              expect(declared, `${where} imports ${spec}`).toContain(spec.slice('@remy/'.length));
            } else if (spec.startsWith('.')) {
              const target = resolve(dirname(file), spec);
              expect(target.startsWith(pkgRoot), `${where} reaches outside via ${spec}`).toBe(true);
            }
          }
        }
      });
    });
  }

  it('core has no third-party runtime dependencies beyond the allowlist', () => {
    const core = readJson<PackageJson>('packages/core/package.json');
    for (const dep of Object.keys(core.dependencies ?? {})) {
      expect(CORE_THIRD_PARTY, `core -> ${dep}`).toContain(dep);
    }
  });
});

describe('tools use capabilities, not globals', () => {
  // Only the capability implementations may touch the filesystem or the network directly.
  const EXEMPT = ['scoped-fs.ts', 'scoped-fetch.ts', 'search-providers.ts'];
  const files = sourceFiles(join(ROOT, 'packages/tools/src')).filter(
    (f) => !f.endsWith('.test.ts') && !EXEMPT.some((e) => f.endsWith(e)),
  );
  for (const file of files) {
    it(relative(ROOT, file), () => {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/from ['"](node:)?(fs|fs\/promises|http|https|net|dns)['"]/);
      expect(src).not.toMatch(/\bfetch\(/);
    });
  }
});
