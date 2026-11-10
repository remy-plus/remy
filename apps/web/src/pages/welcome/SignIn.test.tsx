import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../App.tsx';
import { a11yProblems } from '../../a11y.testing.ts';
import { createHttpApi } from '../../api/http.ts';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { SignIn } from './SignIn.tsx';

afterEach(() => {
  window.location.hash = '';
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A server that accepts one token. */
const server = (good = 'good-token') =>
  vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith('/api/health')) return json(200, { ok: true, version: '0.10.1' });
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${good}`) return json(401, { error: 'unauthorised' });
    return json(200, {
      tasks: [
        { id: 'a', status: 'running' },
        { id: 'b', status: 'succeeded' },
      ],
    });
  });

const show = (fetch: typeof globalThis.fetch, onSignedIn = vi.fn()) => {
  const probe = createHttpApi({ token: () => null, fetch });
  render(
    <ApiProvider api={createMockApi()}>
      <SignIn probe={probe} onSignedIn={onSignedIn} />
    </ApiProvider>,
  );
  return { onSignedIn };
};
const type = (value: string) =>
  fireEvent.change(screen.getByLabelText('Access token'), { target: { value } });
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
const saved = () => window.localStorage.getItem('remy.token');

describe('SignIn', () => {
  it('asks for a token in a password field and shows the server status', async () => {
    show(server());
    expect((screen.getByLabelText('Access token') as HTMLInputElement).type).toBe('password');
    expect(await screen.findByText('Remy 0.10.1')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Server status' })).toBeTruthy();
    expect(screen.getByText(/remy serve token --rotate/)).toBeTruthy();
  });

  it('keeps nothing and says so next to the field when the token is wrong', async () => {
    const fetch = server();
    const { onSignedIn } = show(fetch);
    type('wrong-token');
    submit();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(
      'That token was not accepted. Check it for a missing character, then try again.',
    );
    const field = screen.getByLabelText('Access token');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toContain(alert.id);
    expect(saved()).toBeNull();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('saves the token only after the server accepts it, then carries on', async () => {
    const { onSignedIn } = show(server());
    type(' good-token ');
    expect(saved()).toBeNull();
    submit();
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledTimes(1));
    expect(saved()).toBe('good-token');
    expect(window.localStorage.getItem('remy.onboarded')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when the server cannot be reached, and stores nothing', async () => {
    const down = vi.fn(async () => {
      throw new TypeError('network');
    });
    show(down);
    expect(
      await screen.findByText(
        'Remy could not be reached at this address. Check the address and that Remy is running.',
      ),
    ).toBeTruthy();
    type('good-token');
    submit();
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Remy could not be reached at this address. Check the address and that Remy is running.',
    );
    expect(saved()).toBeNull();
  });

  it('does not call the server for an empty token', async () => {
    const fetch = server();
    show(fetch);
    await screen.findByText('Remy 0.10.1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Enter the token first.');
    expect(fetch.mock.calls.filter(([u]) => String(u).includes('/api/tasks'))).toHaveLength(0);
  });

  it('has no basic accessibility problems', async () => {
    show(server());
    await screen.findByText('Remy 0.10.1');
    expect(a11yProblems()).toEqual([]);
  });

  it('is a full-page route with no bar across the top', async () => {
    window.location.hash = '#/sign-in';
    render(
      <ApiProvider api={createMockApi()}>
        <App />
      </ApiProvider>,
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in to your Remy.' }),
    ).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });
});
