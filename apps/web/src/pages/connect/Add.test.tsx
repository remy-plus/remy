import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiError } from '../../api/http.ts';
import { ApiProvider, type RemyApi } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { testSummary, validateMachine } from './AddMachine.tsx';

afterEach(() => {
  window.location.hash = '';
});

const apiWith = (patch: Partial<RemyApi>): RemyApi => ({ ...createMockApi(), ...patch });

const open = (hash: string, api: RemyApi = createMockApi()) => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

const ok = { name: 'home-server', host: '10.0.0.5', port: '22', user: 'remy', keyPath: '' };

describe('Add a connection', () => {
  it('picks an app and a permission level, then says it is connected', async () => {
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
    // The success is said in place, with a way on to the list.
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Stripe is connected.' }),
    ).toBeTruthy();
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(screen.getByText(/Remy can use it the next time it starts/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See your connections' }).getAttribute('href')).toBe(
      '#/connections',
    );
    expect(window.location.hash).toBe('#/connections/add');
  });

  it('filters the apps by the search box, and clears it', async () => {
    open('#/connections/add');
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search apps' }), {
      target: { value: 'zoo' },
    });
    expect(screen.getAllByRole('radio', { name: /Zoom/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('radio', { name: /Figma/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('radio', { name: /Figma/ })).toBeTruthy();
  });

  it('offers a way out when no app matches the search', async () => {
    open('#/connections/add');
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search apps' }), {
      target: { value: 'nothing like this' },
    });
    expect(screen.getByText('No app matches “nothing like this”.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect(screen.getByRole('radio', { name: /Linear/ })).toBeTruthy();
  });

  it('says which status stopped a connection, in the server’s own words', async () => {
    open('#/connections/add', apiWith({ connectApp: () => Promise.reject(new ApiError(500, '')) }));
    fireEvent.click(await screen.findByRole('button', { name: 'Connect Linear' }));
    expect(
      await screen.findByText("Remy's server hit a problem. Try again in a moment."),
    ).toBeTruthy();
  });

  it('is honest that an app by its own address is added in the terminal', async () => {
    open('#/connections/add');
    await screen.findByRole('radiogroup', { name: 'App' });
    expect(screen.getByText(/remy connect add/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add by address' })).toBeNull();
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

  it('says which part of the test stopped, from the server’s own lines', () => {
    expect(testSummary('home-server', { ok: true, lines: ['Connected to remy@10.0.0.5.'] })).toBe(
      'home-server answered.',
    );
    expect(
      testSummary('home-server', { ok: false, lines: ['Permission denied (publickey).'] }),
    ).toMatch(/the sign-in was refused/);
    expect(
      testSummary('home-server', { ok: false, lines: ['Host key verification failed.'] }),
    ).toMatch(/does not recognise its host key/);
    expect(
      testSummary('home-server', {
        ok: false,
        lines: ['ssh: connect to host 10.0.0.5 port 22: Connection refused'],
      }),
    ).toMatch(/could not reach home-server at that address/);
    expect(testSummary('home-server', { ok: false, lines: ['Something odd.'] })).toMatch(
      /could not get in to home-server/,
    );
  });

  it('marks a bad field and shows the message next to it', async () => {
    open('#/connections/machine');
    const address = await screen.findByRole('textbox', { name: 'Address' });
    fireEvent.change(address, { target: { value: '-oProxyCommand=x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add this machine' }));
    await waitFor(() => expect(address.getAttribute('aria-invalid')).toBe('true'));
    const msg = document.getElementById(address.getAttribute('aria-describedby') ?? '');
    expect(msg?.textContent).toMatch(/cannot start with a dash/);
    expect(window.location.hash).toBe('#/connections/machine');
  });

  it('tests the connection into a status region, then adds the machine', async () => {
    open('#/connections/machine');
    fireEvent.click(await screen.findByRole('button', { name: 'Test the connection' }));
    expect(await screen.findByText('home-server answered.')).toBeTruthy();
    expect(await screen.findByText('Connected to home-server')).toBeTruthy();
    expect(
      screen.getAllByRole('status').some((r) => /Host key checked/.test(r.textContent ?? '')),
    ).toBe(true);
    expect(
      (screen.getByRole('textbox', { name: 'Address' }) as HTMLInputElement).getAttribute(
        'aria-invalid',
      ),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add this machine' }));
    expect(
      await screen.findByRole('heading', { level: 2, name: 'home-server is added.' }),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See your machines' }).getAttribute('href')).toBe(
      '#/connections',
    );
  });

  it('says which part of the test stopped when the server refuses the sign-in', async () => {
    open(
      '#/connections/machine',
      apiWith({
        testMachine: async () => ({ ok: false, lines: ['Permission denied (publickey).'] }),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Test the connection' }));
    expect(
      await screen.findByText(
        'Remy reached home-server, but the sign-in was refused. Check the user and the key.',
      ),
    ).toBeTruthy();
  });

  it('says which status stopped adding a machine, in the server’s own words', async () => {
    open(
      '#/connections/machine',
      apiWith({
        addMachine: () =>
          Promise.reject(new ApiError(409, 'There is already a machine named home-server.')),
      }),
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add this machine' }));
    expect(await screen.findByText('There is already a machine named home-server.')).toBeTruthy();
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
