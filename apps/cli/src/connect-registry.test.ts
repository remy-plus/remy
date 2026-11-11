// A registry record becoming a connection: the name it gets, and the config it saves.
import { describe, expect, it } from 'vitest';
import { planFromRegistry, registryName } from './connect-plan.ts';
import type { RegistryApp } from './mcp-registry.ts';

const remote: RegistryApp = {
  name: 'app.linear/linear',
  title: 'Linear',
  description: 'Issues and projects.',
  version: '1.0.0',
  kind: 'remote',
  url: 'https://mcp.linear.app/mcp',
  secrets: [],
};

const withHeader: RegistryApp = {
  ...remote,
  name: 'ai.smithery/smithery-ai-slack',
  title: 'Slack',
  secrets: [
    {
      key: 'Authorization',
      label: 'Smithery token',
      where: 'Smithery token',
      template: 'Bearer {smithery_api_key}',
    },
  ],
};

const pkg: RegistryApp = {
  name: 'io.github.me/mcp-filesystem',
  title: 'Filesystem',
  description: 'Read and write files.',
  version: '0.2.0',
  kind: 'package',
  command: 'npx',
  args: ['-y', '@me/mcp-filesystem'],
  secrets: [{ key: 'WORKSPACE_ROOT', label: 'Folder', where: 'Folder to serve' }],
};

describe('registryName', () => {
  it('drops a generic last segment in favour of the one before it', () => {
    expect(registryName('ac.inference.sh/mcp', new Set())).toBe('ac.inference.sh');
    expect(registryName('com.notion/mcp', new Set())).toBe('com.notion');
  });

  it('uses the last segment when it says something', () => {
    expect(registryName('io.github.me/thing', new Set())).toBe('thing');
    expect(registryName('app.linear/linear', new Set())).toBe('linear');
  });

  it('takes a name with no slash as it is', () => {
    expect(registryName('x', new Set())).toBe('x');
  });

  it('numbers a name that is already in use', () => {
    expect(registryName('app.linear/linear', new Set(['linear']))).toBe('linear-2');
    expect(registryName('app.linear/linear', new Set(['linear', 'linear-2']))).toBe('linear-3');
  });

  it('makes a name a server name can hold', () => {
    expect(registryName('io.github.me/a b', new Set())).toBe('a-b');
    expect(registryName('io.github.me/--x', new Set())).toBe('x');
  });

  it('does not leave a separator at the end of a shortened name', () => {
    const long = `io.github.me/${'a'.repeat(40)}-tail`;
    expect(registryName(long, new Set())).toBe('a'.repeat(36));
  });
});

describe('planFromRegistry', () => {
  it('saves a hosted server as its address', () => {
    const plan = planFromRegistry(remote, { taken: new Set() });
    expect(plan.name).toBe('linear');
    expect(plan.config).toEqual({ url: 'https://mcp.linear.app/mcp' });
    expect(plan.command).toBeUndefined();
    expect(plan.label).toBe('Linear');
    expect(plan.oauth).toBe(false);
  });

  it('points a header at the secret it will be given', () => {
    const plan = planFromRegistry(withHeader, { taken: new Set() });
    expect(plan.config).toEqual({
      url: 'https://mcp.linear.app/mcp',
      headers: { Authorization: 'Bearer ${secret:smithery-ai-slack.Authorization}' },
    });
    expect(plan.secrets.map((s) => s.key)).toEqual(['Authorization']);
  });

  it('saves a package as the command this machine runs', () => {
    const plan = planFromRegistry(pkg, { taken: new Set() });
    expect(plan.name).toBe('mcp-filesystem');
    expect(plan.command).toBe('npx -y @me/mcp-filesystem');
    expect(plan.config).toEqual({
      command: 'npx',
      args: ['-y', '@me/mcp-filesystem'],
      env: { WORKSPACE_ROOT: '${secret:mcp-filesystem.WORKSPACE_ROOT}' },
    });
  });

  it('refuses a name that is already taken', () => {
    expect(() => planFromRegistry(remote, { taken: new Set(['linear']), name: 'linear' })).toThrow(
      /already a server named linear/,
    );
  });

  it('refuses a secret key that cannot be stored', () => {
    const odd: RegistryApp = {
      ...remote,
      secrets: [{ key: 'a b', label: 'Odd', where: 'Odd' }],
    };
    expect(() => planFromRegistry(odd, { taken: new Set() })).toThrow(/cannot be kept as a secret/);
  });

  it('refuses a record that does not say where it is', () => {
    const broken: RegistryApp = { ...remote, url: undefined };
    expect(() => planFromRegistry(broken, { taken: new Set() })).toThrow(/does not say where/);
  });
});
