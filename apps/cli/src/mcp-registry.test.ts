import { describe, expect, it } from 'vitest';
import { headerValue, searchRegistry, toApp, toApps } from './mcp-registry.ts';

const remote = {
  server: {
    name: 'ac.inference.sh/mcp',
    title: 'inference.sh',
    description: 'Run 150+ AI apps.',
    version: '2.0.0',
    remotes: [{ type: 'streamable-http', url: 'https://api.inference.sh/mcp' }],
  },
  _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
};

const withHeader = {
  server: {
    name: 'ai.smithery/smithery-notion',
    description: 'A Notion workspace.',
    version: '1.0.0',
    remotes: [
      {
        type: 'streamable-http',
        url: 'https://server.smithery.ai/@smithery/notion/mcp',
        headers: [
          {
            name: 'Authorization',
            value: 'Bearer {smithery_api_key}',
            description: 'Bearer token for Smithery authentication',
            isRequired: true,
            isSecret: true,
          },
        ],
      },
    ],
  },
  _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
};

const withPackage = {
  server: {
    name: 'com.pulsemcp/remote-filesystem',
    description: 'Remote filesystem operations.',
    version: '0.1.2',
    packages: [
      {
        registryType: 'npm',
        identifier: 'remote-filesystem-mcp-server',
        version: '0.1.2',
        runtimeHint: 'npx',
        transport: { type: 'stdio' },
        runtimeArguments: [{ type: 'positional', value: '-y' }],
        environmentVariables: [
          { name: 'GCS_BUCKET', description: 'Bucket name.', isRequired: true },
          { name: 'GCS_PROJECT_ID', description: 'Project id.' },
        ],
      },
    ],
  },
  _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true } },
};

describe('icons', () => {
  const withIcons = (icons: unknown) => ({
    server: { ...remote.server, icons },
  });
  const png = { src: 'https://x.test/a.png', mimeType: 'image/png', sizes: ['48x48'] };

  it('passes on an https icon of an allowed type', () => {
    expect(toApp(withIcons([png]))?.icon).toBe('https://x.test/a.png');
    for (const mimeType of ['image/svg+xml', 'image/webp', 'image/jpeg'])
      expect(toApp(withIcons([{ src: 'https://x.test/i', mimeType }]))?.icon).toBe(
        'https://x.test/i',
      );
  });

  it('skips http, other types and junk, then takes the next good one', () => {
    expect(
      toApp(withIcons([{ src: 'http://x.test/a.png', mimeType: 'image/png' }]))?.icon,
    ).toBeUndefined();
    expect(
      toApp(withIcons([{ src: 'https://x.test/a.gif', mimeType: 'image/gif' }]))?.icon,
    ).toBeUndefined();
    expect(
      toApp(withIcons([{ src: 'data:image/png;base64,AA', mimeType: 'image/png' }]))?.icon,
    ).toBeUndefined();
    expect(
      toApp(withIcons([{ src: 'javascript:1', mimeType: 'image/png' }]))?.icon,
    ).toBeUndefined();
    expect(toApp(withIcons('nope'))?.icon).toBeUndefined();
    expect(
      toApp(withIcons([null, { src: 'http://x.test/a.png', mimeType: 'image/png' }, png]))?.icon,
    ).toBe('https://x.test/a.png');
  });

  it('leaves icon out when the record has none', () => {
    expect(toApp(remote)).not.toHaveProperty('icon');
  });
});

describe('toApp', () => {
  it('reads a hosted server as a remote app', () => {
    expect(toApp(remote)).toEqual({
      name: 'ac.inference.sh/mcp',
      title: 'inference.sh',
      description: 'Run 150+ AI apps.',
      version: '2.0.0',
      kind: 'remote',
      url: 'https://api.inference.sh/mcp',
      secrets: [],
    });
  });

  it('falls back to the registry name when the record has no title', () => {
    expect(toApp(withHeader)?.title).toBe('ai.smithery/smithery-notion');
  });

  it('asks only for the headers a server needs', () => {
    expect(toApp(withHeader)?.secrets).toEqual([
      {
        key: 'Authorization',
        label: 'Bearer token for Smithery authentication',
        where: 'Bearer token for Smithery authentication',
        template: 'Bearer {smithery_api_key}',
      },
    ]);
  });

  it('reads a package as the command this machine would run', () => {
    const app = toApp(withPackage);
    expect(app?.kind).toBe('package');
    expect(app?.command).toBe('npx');
    expect(app?.args).toEqual(['-y', 'remote-filesystem-mcp-server']);
  });

  it('asks only for the environment a package requires', () => {
    expect(toApp(withPackage)?.secrets.map((s) => s.key)).toEqual(['GCS_BUCKET']);
  });

  it('adds -y when a package record leaves it out, so npx does not stop to ask', () => {
    const quiet = {
      ...withPackage,
      server: {
        ...withPackage.server,
        packages: [{ ...withPackage.server.packages[0], runtimeArguments: [] }],
      },
    };
    expect(toApp(quiet)?.args).toEqual(['-y', 'remote-filesystem-mcp-server']);
  });

  it('keeps the record order when it already says -y', () => {
    expect(toApp(withPackage)?.args).toEqual(['-y', 'remote-filesystem-mcp-server']);
  });

  it('skips a record with no way to reach it', () => {
    expect(toApp({ server: { name: 'x/y', version: '1.0.0' } })).toBeUndefined();
  });

  it('skips a record with no name', () => {
    expect(toApp({ server: { version: '1.0.0' } })).toBeUndefined();
  });

  it('refuses a remote that is not http', () => {
    const app = toApp({
      server: { name: 'x/y', remotes: [{ type: 'sse', url: 'file:///etc/passwd' }] },
    });
    expect(app).toBeUndefined();
  });

  it('ignores a package type it does not run', () => {
    const app = toApp({
      server: { name: 'x/y', packages: [{ registryType: 'nuget', identifier: 'thing' }] },
    });
    expect(app).toBeUndefined();
  });

  it('runs a pypi package with uvx, package arguments after the name', () => {
    const app = toApp({
      server: {
        name: 'x/py',
        packages: [
          {
            registryType: 'pypi',
            identifier: 'thing-mcp',
            runtimeArguments: [{ type: 'named', name: '--python', value: '3.12' }],
            packageArguments: [{ type: 'positional', value: 'serve' }],
          },
        ],
      },
    });
    expect(app?.kind).toBe('package');
    expect(app?.command).toBe('uvx');
    expect(app?.args).toEqual(['--python', '3.12', 'thing-mcp', 'serve']);
  });

  it('runs an oci package with docker and forwards each secret by name', () => {
    const app = toApp({
      server: {
        name: 'x/box',
        packages: [
          {
            registryType: 'oci',
            identifier: 'ghcr.io/x/box:1.0',
            packageArguments: [{ type: 'named', name: '--mode', value: 'stdio' }],
            environmentVariables: [
              { name: 'BOX_TOKEN', isRequired: true, isSecret: true },
              { name: 'BOX_DEBUG' },
            ],
          },
        ],
      },
    });
    expect(app?.command).toBe('docker');
    expect(app?.args).toEqual([
      'run',
      '-i',
      '--rm',
      '-e',
      'BOX_TOKEN',
      'ghcr.io/x/box:1.0',
      '--mode',
      'stdio',
    ]);
    expect(app?.secrets.map((x) => x.key)).toEqual(['BOX_TOKEN']);
  });

  it('turns named arguments into a name and a value, positional ones into the value', () => {
    const app = toApp({
      server: {
        name: 'x/args',
        packages: [
          {
            registryType: 'npm',
            identifier: 'pkg',
            runtimeArguments: [{ type: 'named', name: '--flag' }],
            packageArguments: [
              { type: 'named', name: '--port', value: '80' },
              { type: 'named', name: '--host=local' },
              { type: 'positional', value: 'start' },
            ],
          },
        ],
      },
    });
    expect(app?.args).toEqual(['-y', '--flag', 'pkg', '--port', '80', '--host=local', 'start']);
  });

  it('drops an argument that needs a value it cannot fill', () => {
    const app = toApp({
      server: {
        name: 'x/hole',
        packages: [
          {
            registryType: 'npm',
            identifier: 'pkg',
            packageArguments: [
              { type: 'named', name: '--path', value: '{workspace}' },
              { type: 'positional', value: 'run' },
            ],
          },
        ],
      },
    });
    expect(app?.args).toEqual(['-y', 'pkg', 'run']);
  });

  it('prefers npm, then pypi, then oci', () => {
    const pk = (registryType: string) => ({ registryType, identifier: `id-${registryType}` });
    const cmd = (types: string[]) =>
      toApp({ server: { name: 'x/m', packages: types.map(pk) } })?.args?.join(' ');
    expect(cmd(['oci', 'pypi', 'npm'])).toBe('-y id-npm');
    expect(cmd(['oci', 'pypi'])).toBe('id-pypi');
    expect(cmd(['oci'])).toBe('run -i --rm id-oci');
  });
});

describe('toApps', () => {
  it('keeps the newest version of each server, once', () => {
    const older = {
      server: { ...remote.server, version: '1.0.0' },
      _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false } },
    };
    expect(toApps({ servers: [older, remote, remote] }).map((a) => a.version)).toEqual(['2.0.0']);
  });

  it('survives a body that is not a list', () => {
    expect(toApps({})).toEqual([]);
    expect(toApps(null)).toEqual([]);
  });
});

describe('headerValue', () => {
  it('turns the record placeholder into the secret reference Remy stores', () => {
    expect(headerValue('Bearer {smithery_api_key}', 'notion', 'Authorization')).toBe(
      'Bearer ${secret:notion.Authorization}',
    );
  });

  it('leaves a value with no placeholder alone', () => {
    expect(headerValue('Bearer abc', 'notion', 'Authorization')).toBe('Bearer abc');
  });
});

describe('searchRegistry', () => {
  const ok = (body: unknown) =>
    ({
      ok: true,
      status: 200,
      json: async () => body,
    }) as unknown as Response;

  it('asks the registry for the query and the limit', async () => {
    let asked = '';
    await searchRegistry('notion', {
      limit: 5,
      fetch: async (url) => {
        asked = url;
        return ok({ servers: [remote] });
      },
    });
    expect(asked).toContain('search=notion');
    expect(asked).toContain('limit=5');
  });

  it('leaves the search out for a blank query', async () => {
    let asked = '';
    await searchRegistry('  ', {
      fetch: async (url) => {
        asked = url;
        return ok({ servers: [] });
      },
    });
    expect(asked).not.toContain('search=');
  });

  it('says the registry is unreachable, not that the app does not exist', async () => {
    await expect(
      searchRegistry('x', {
        fetch: async () => {
          throw new Error('offline');
        },
      }),
    ).rejects.toThrow(/could not be reached/);
  });

  it('names the status when the registry refuses', async () => {
    await expect(
      searchRegistry('x', {
        fetch: async () => ({ ok: false, status: 503 }) as unknown as Response,
      }),
    ).rejects.toThrow(/503/);
  });

  it('says so when the answer is not a list', async () => {
    await expect(
      searchRegistry('x', {
        fetch: async () =>
          ({
            ok: true,
            status: 200,
            json: async () => {
              throw new Error('not json');
            },
          }) as unknown as Response,
      }),
    ).rejects.toThrow(/not a list of apps/);
  });
});
