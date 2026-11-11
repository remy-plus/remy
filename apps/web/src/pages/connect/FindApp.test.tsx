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
});
