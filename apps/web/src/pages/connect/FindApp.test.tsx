import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider, type RemyApi } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
  vi.restoreAllMocks();
});

const apiWith = (patch: Partial<RemyApi>): RemyApi => ({ ...createMockApi(), ...patch });

const open = (api: RemyApi = createMockApi()) => {
  window.location.hash = '#/connections/add';
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

const type = (text: string) =>
  fireEvent.change(screen.getByLabelText('Search the official registry'), {
    target: { value: text },
  });

describe('Find any app', () => {
  it('says what to do before anything is typed', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 2, name: 'Find any app' })).toBeTruthy();
    expect(screen.getByText('Type at least 2 letters.')).toBeTruthy();
  });

  it('lists what the registry has, with the address that would be added', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Find any app' });
    type('linear');
    expect(await screen.findByText('https://mcp.linear.app/mcp')).toBeTruthy();
    expect(screen.getByText('Hosted')).toBeTruthy();
    expect(screen.getByText(/official registry, not from Remy/)).toBeTruthy();
  });

  it('marks a package as something this machine runs', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Find any app' });
    type('filesystem');
    expect(await screen.findByText('npx -y @me/mcp-filesystem')).toBeTruthy();
    expect(screen.getByText('Runs here')).toBeTruthy();
  });

  it('says so when nothing matches', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Find any app' });
    type('zzzz');
    expect(await screen.findByText(/Nothing in the official registry matches/)).toBeTruthy();
  });

  it('shows the reason when the registry cannot be reached', async () => {
    open(
      apiWith({
        searchApps: () => Promise.reject(new Error('The app registry could not be reached.')),
      }),
    );
    await screen.findByRole('heading', { level: 2, name: 'Find any app' });
    type('linear');
    expect(await screen.findByText(/could not be reached/)).toBeTruthy();
  });

  it('copies the exact command that adds the app', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open();
    await screen.findByRole('heading', { level: 2, name: 'Find any app' });
    type('linear');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the command to add Linear' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('remy connect --registry app.linear/linear'),
    );
    expect(await screen.findByText('Copied')).toBeTruthy();
  });

  it('shows the command when the browser never answers the clipboard', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => new Promise(() => {})) },
      configurable: true,
    });
    open();
    await screen.findByRole('heading', { level: 2, name: 'Find any app' });
    type('linear');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the command to add Linear' }));
    expect(
      await screen.findByText('remy connect --registry app.linear/linear', undefined, {
        timeout: 4000,
      }),
    ).toBeTruthy();
  });

  it('shows the command when the browser will not let the page copy', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    open();
    await screen.findByRole('heading', { level: 2, name: 'Find any app' });
    type('linear');
    fireEvent.click(await screen.findByRole('button', { name: 'Copy the command to add Linear' }));
    expect(await screen.findByText('remy connect --registry app.linear/linear')).toBeTruthy();
  });

  describe('marks', () => {
    const hit = (name: string, title: string, icon?: string) => ({
      name,
      title,
      description: '',
      version: '1',
      kind: 'remote' as const,
      where: `https://${name}.test`,
      command: `remy connect --registry ${name}`,
      ...(icon && { icon }),
    });
    const searching = (...apps: ReturnType<typeof hit>[]) =>
      apiWith({ searchApps: () => Promise.resolve({ apps, note: 'note' }) });
    const find = async (api: RemyApi) => {
      open(api);
      await screen.findByRole('heading', { level: 2, name: 'Find any app' });
      type('zz');
      await screen.findByText('Sentry');
      return document.querySelector('section ul') as HTMLElement;
    };

    it('shows an https icon as a lazy image with no referrer', async () => {
      const list = await find(searching(hit('s', 'Sentry', 'https://s.test/i.png')));
      const img = list.querySelector('img') as HTMLImageElement;
      expect(img.getAttribute('src')).toBe('https://s.test/i.png');
      expect(img.getAttribute('alt')).toBe('');
      expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
      expect(img.getAttribute('loading')).toBe('lazy');
      expect(list.querySelector('[data-monogram]')).toBeNull();
    });

    it('shows a monogram when the icon is missing or not https', async () => {
      const list = await find(searching(hit('s', 'Sentry', 'http://s.test/i.png')));
      expect(list.querySelector('img')).toBeNull();
      expect(list.querySelector('[data-monogram]')?.textContent).toBe('S');
    });

    it('falls back to the monogram when the image fails', async () => {
      const list = await find(searching(hit('s', 'Sentry', 'https://s.test/i.png')));
      fireEvent.error(list.querySelector('img') as HTMLImageElement);
      expect(list.querySelector('img')).toBeNull();
      expect(list.querySelector('[data-monogram]')?.textContent).toBe('S');
    });
  });
});
