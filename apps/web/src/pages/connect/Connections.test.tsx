import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiError } from '../../api/http.ts';
import { ApiProvider, type RemyApi } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const apiWith = (patch: Partial<RemyApi>): RemyApi => ({ ...createMockApi(), ...patch });

const open = (hash = '#/connections', api: RemyApi = createMockApi()) => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

describe('Connections', () => {
  it('lists apps and machines, with statuses as text', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connections' })).toBeTruthy();
    const apps = screen.getByRole('region', { name: 'Apps' });
    expect(within(apps).getAllByRole('heading', { level: 3 })).toHaveLength(5);
    expect(within(apps).getByText('Connected · read only')).toBeTruthy();
    expect(within(apps).getByRole('button', { name: 'Sign in to Slack' })).toBeTruthy();
    expect(within(apps).getByRole('button', { name: 'Connect GitHub' })).toBeTruthy();
    const machines = screen.getByRole('region', { name: 'Machines' });
    expect(within(machines).getByRole('button', { name: 'Manage home-server' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect an app' }).getAttribute('href')).toBe(
      '#/connections/add',
    );
    expect(screen.getByRole('link', { name: 'Add a machine' }).getAttribute('href')).toBe(
      '#/connections/machine',
    );
  });

  it('says what a machine is for, in one line', async () => {
    open();
    const machines = await screen.findByRole('region', { name: 'Machines' });
    expect(
      within(machines).getByText(
        'A machine is a computer Remy can run commands on, with your key. It asks before each one.',
      ),
    ).toBeTruthy();
  });

  it('toggles a permission with a real, keyboard-operable switch', async () => {
    open();
    const sw = await screen.findByRole('switch', { name: 'Delete mail' });
    expect((sw as HTMLInputElement).checked).toBe(false);
    fireEvent.click(sw);
    await waitFor(() =>
      expect(
        (screen.getByRole('switch', { name: 'Delete mail' }) as HTMLInputElement).checked,
      ).toBe(true),
    );
    expect(
      screen.getByText('Gmail: Delete mail is on. It applies the next time Remy starts.'),
    ).toBeTruthy();
    // A native checkbox is focusable and toggles with Space, so there is no custom key code to test.
    expect(sw.tagName).toBe('INPUT');
    expect(sw.getAttribute('tabindex')).toBeNull();
  });

  it('shows the permissions of the app being managed', async () => {
    open();
    await screen.findByRole('switch', { name: 'Read mail' });
    fireEvent.click(screen.getByRole('button', { name: 'Manage Notion' }));
    expect(await screen.findByRole('switch', { name: 'Edit pages' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Read mail' })).toBeNull();
  });

  it('asks before disconnecting, and Keep it calls nothing', async () => {
    let calls = 0;
    open('#/connections', apiWith({ disconnectApp: async () => void calls++ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Gmail' }));
    const dialog = await screen.findByRole('dialog', { name: 'Disconnect Gmail?' });
    expect(
      within(dialog).getByText(
        'Remy will stop using Gmail right away. You can connect it again later.',
      ),
    ).toBeTruthy();
    expect(calls).toBe(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Disconnect Gmail?' })).toBeNull(),
    );
    expect(calls).toBe(0);
    expect(screen.queryByText('Gmail is disconnected.')).toBeNull();
  });

  it('asks before removing a machine, then removes it by name', async () => {
    const removed: string[] = [];
    open(
      '#/connections',
      apiWith({
        removeMachine: async (n) => void removed.push(n),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Manage home-server' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove this machine' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove home-server?' });
    expect(
      within(dialog).getByText(
        'Remy will stop using this machine. Its settings on that machine are not touched.',
      ),
    ).toBeTruthy();
    expect(removed).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    expect(removed).toEqual([]);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove this machine' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('home-server is removed.')).toBeTruthy();
    expect(removed).toEqual(['home-server']);
  });

  it('disconnects and signs in, saying so beside the app it changed', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Gmail' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText('Gmail is disconnected.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Connect Gmail' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }));
    expect(await screen.findByRole('button', { name: 'Manage Slack' })).toBeTruthy();
    // The success line sits in the Slack row, not in the panel about another app.
    const apps = screen.getByRole('region', { name: 'Apps' });
    expect(within(apps).getByText('Slack is connected.')).toBeTruthy();
  });

  it('says which status stopped a change, in the server’s own words', async () => {
    open('#/connections', apiWith({ setPermission: () => Promise.reject(new ApiError(403, '')) }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Delete mail' }));
    expect(
      await screen.findByText(
        "Remy is not allowed to do that. Check the app's permissions in Connections.",
      ),
    ).toBeTruthy();
  });

  it('offers a way forward when nothing is connected and no machine is added', async () => {
    open('#/connections', apiWith({ connections: async () => ({ apps: [], machines: [] }) }));
    expect(await screen.findByText('No app is connected yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Connect an app' }).getAttribute('href')).toBe(
      '#/connections/add',
    );
    expect(screen.getByText('No machine is added yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a machine' }).getAttribute('href')).toBe(
      '#/connections/machine',
    );
    expect(screen.getByText(/Nothing is connected yet/)).toBeTruthy();
  });

  it('points at the machines when no app is connected but a machine is added', async () => {
    open(
      '#/connections',
      apiWith({
        connections: async () => ({
          apps: [],
          machines: [{ name: 'home-server', detail: 'ssh remy@10.0.0.5', status: 'reachable' }],
        }),
      }),
    );
    expect(await screen.findByText('Pick a machine to see how Remy behaves there.')).toBeTruthy();
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('switch', { name: 'Read mail' });
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('complementary')).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
    for (const s of screen.getAllByRole('switch'))
      expect(s.getAttribute('aria-label')).toBeTruthy();
  });
});
