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

  it('ignores a package that is not npm', () => {
    const app = toApp({
      server: { name: 'x/y', packages: [{ registryType: 'pypi', identifier: 'thing' }] },
    });
    expect(app).toBeUndefined();
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
