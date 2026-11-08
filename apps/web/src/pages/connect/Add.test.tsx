import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { validateMachine } from './AddMachine.tsx';

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

const ok = { name: 'home-server', host: '10.0.0.5', port: '22', user: 'remy', keyPath: '' };

describe('Add a connection', () => {
  it('picks an app and a permission level, then connects', async () => {
    open('#/connections/add');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'What should Remy reach?' }),
    ).toBeTruthy();
    const apps = screen.getByRole('radiogroup', { name: 'App' });
    expect(apps.querySelectorAll('input[type=radio]')).toHaveLength(6);
    fireEvent.click(screen.getByRole('radio', { name: /Stripe/ }));
    expect(screen.getByRole('heading', { level: 2, name: 'Connect Stripe' })).toBeTruthy();
    const levels = screen.getByRole('radiogroup', { name: 'What may Remy do?' });
    expect(levels).toBeTruthy();
    expect(
      (screen.getByRole('radio', { name: /Read and draft/ }) as HTMLInputElement).checked,
    ).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Read only/ }));
    expect((screen.getByRole('radio', { name: /Read only/ }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect(
      (screen.getByRole('radio', { name: /Read and draft/ }) as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Connect Stripe' }));
    await waitFor(() => expect(window.location.hash).toBe('#/connections'));
  });

  it('filters the apps by the search box', async () => {
    open('#/connections/add');
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search apps' }), {
      target: { value: 'zoo' },
    });
    expect(screen.getAllByRole('radio', { name: /Zoom/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('radio', { name: /Figma/ })).toBeNull();
  });

  it('has landmarks and no unnamed button', async () => {
    open('#/connections/add');
    await screen.findByRole('radiogroup', { name: 'App' });
    expect(screen.getByRole('main')).toBeTruthy();
    const nav = within(screen.getByRole('navigation', { name: 'Main' }));
    expect(nav.getByRole('link', { name: 'Connections' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('complementary')).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
  });
});

describe('Add a machine', () => {
  it('accepts a plain name and rejects an ssh option, as sshComputer does', () => {
    expect(validateMachine(ok)).toEqual({});
    expect(validateMachine({ ...ok, host: '-oProxyCommand=x' }).host).toBeTruthy();
    expect(validateMachine({ ...ok, user: '-l' }).user).toBeTruthy();
    expect(validateMachine({ ...ok, name: 'my server' }).name).toBeTruthy();
    expect(validateMachine({ ...ok, host: 'a b' }).host).toBeTruthy();
    expect(validateMachine({ ...ok, port: '70000' }).port).toBeTruthy();
    expect(validateMachine({ ...ok, keyPath: '-i' }).keyPath).toBeTruthy();
  });

  it('marks a bad field and shows the message next to it', async () => {
    open('#/connections/machine');
    const address = await screen.findByRole('textbox', { name: 'Address' });
    fireEvent.change(address, { target: { value: '-oProxyCommand=x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add home-server' }));
    await waitFor(() => expect(address.getAttribute('aria-invalid')).toBe('true'));
    const msg = document.getElementById(address.getAttribute('aria-describedby') ?? '');
    expect(msg?.textContent).toMatch(/cannot start with a dash/);
    expect(window.location.hash).toBe('#/connections/machine');
  });

  it('tests the connection into a status region, then adds the machine', async () => {
    open('#/connections/machine');
    fireEvent.click(await screen.findByRole('button', { name: 'Test the connection' }));
    expect(await screen.findByText('Connected to home-server')).toBeTruthy();
    expect(
      screen.getAllByRole('status').some((r) => /Host key checked/.test(r.textContent ?? '')),
    ).toBe(true);
    expect(
      (screen.getByRole('textbox', { name: 'Address' }) as HTMLInputElement).getAttribute(
        'aria-invalid',
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add home-server' }));
    await waitFor(() => expect(window.location.hash).toBe('#/connections'));
  });

  it('lists the four rules and has landmarks', async () => {
    open('#/connections/machine');
    await screen.findByRole('button', { name: 'Test the connection' });
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('complementary')).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
  });
});
