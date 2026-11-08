import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const open = (hash: string) => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={createMockApi()}>
      <App />
    </ApiProvider>,
  );
};

describe('Connections', () => {
  it('lists apps and machines, with statuses as text', async () => {
    open('#/connections');
    expect(await screen.findByRole('heading', { level: 1, name: 'Connections' })).toBeTruthy();
    const apps = screen.getByRole('region', { name: 'Apps' });
    expect(within(apps).getAllByRole('heading', { level: 3 })).toHaveLength(5);
    expect(within(apps).getByText('Connected · read only')).toBeTruthy();
    expect(within(apps).getByRole('button', { name: 'Sign in to Slack' })).toBeTruthy();
    expect(within(apps).getByRole('button', { name: 'Connect GitHub' })).toBeTruthy();
    const machines = screen.getByRole('region', { name: 'Machines' });
    expect(within(machines).getByRole('button', { name: 'Manage home-server' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Add a connection' }).getAttribute('href')).toBe(
      '#/connections/add',
    );
    expect(screen.getByRole('link', { name: 'Add a machine' }).getAttribute('href')).toBe(
      '#/connections/machine',
    );
  });

  it('toggles a permission with a real, keyboard-operable switch', async () => {
    open('#/connections');
    const sw = await screen.findByRole('switch', { name: 'Delete mail' });
    expect((sw as HTMLInputElement).checked).toBe(false);
    fireEvent.click(sw);
    await waitFor(() =>
      expect(
        (screen.getByRole('switch', { name: 'Delete mail' }) as HTMLInputElement).checked,
      ).toBe(true),
    );
    expect(screen.getByText('Gmail: Delete mail is on.')).toBeTruthy();
    // A native checkbox is focusable and toggles with Space, so there is no custom key code to test.
    expect(sw.tagName).toBe('INPUT');
    expect(sw.getAttribute('tabindex')).toBeNull();
  });

  it('shows the permissions of the app being managed', async () => {
    open('#/connections');
    await screen.findByRole('switch', { name: 'Read mail' });
    fireEvent.click(screen.getByRole('button', { name: 'Manage Notion' }));
    expect(await screen.findByRole('switch', { name: 'Edit pages' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Read mail' })).toBeNull();
  });

  it('disconnects and signs in', async () => {
    open('#/connections');
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect Gmail' }));
    expect(await screen.findByText('Gmail is disconnected.')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Connect Gmail' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to Slack' }));
    expect(await screen.findByRole('button', { name: 'Manage Slack' })).toBeTruthy();
  });

  it('has landmarks and no unnamed button', async () => {
    open('#/connections');
    await screen.findByRole('switch', { name: 'Read mail' });
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('complementary')).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
    for (const s of screen.getAllByRole('switch'))
      expect(s.getAttribute('aria-label')).toBeTruthy();
  });
});
