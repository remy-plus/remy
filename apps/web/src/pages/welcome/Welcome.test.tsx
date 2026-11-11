import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { a11yProblems } from '../../a11y.testing.ts';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
  window.localStorage.removeItem('remy.token');
});

/** Onboarding is reachable without a session; these tests say which case they mean. */
const signedIn = () => window.localStorage.setItem('remy.token', 'a-token');

const openWith = (api: ReturnType<typeof createMockApi>, hash: string) => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

const open = (hash: string) => openWith(createMockApi(), hash);

describe('Welcome', () => {
  it('step 1 offers three ways to think, marks the step and goes on', async () => {
    open('#/welcome/1');
    expect(await screen.findByRole('heading', { level: 1, name: "Hi, I'm Remy." })).toBeTruthy();
    const trace = screen.getByRole('list', { name: 'Setup steps' });
    expect(within(trace).getAllByRole('listitem')).toHaveLength(3);
    expect(
      within(trace)
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-current')),
    ).toEqual(['step', null, null]);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('#/welcome/2');
    // No bar across the top on a full-page screen.
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('never asks for a key in the browser: it names the command that stores one', async () => {
    open('#/welcome/1');
    expect(await screen.findByText('remy login')).toBeTruthy();
    // A key typed into this page could not be stored, so there is no field to type one into.
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy the command to run sign in' })).toBeTruthy();
    // The button moves to the next step. It does not save anything, so it does not say it does.
    expect(screen.getByRole('link', { name: 'Continue' }).getAttribute('href')).toBe('#/welcome/2');
    expect(screen.queryByText(/Save and continue/)).toBeNull();
  });

  it('checks the model Remy is already set up with', async () => {
    open('#/welcome/1');
    fireEvent.click(await screen.findByRole('button', { name: 'Check the model' }));
    expect(await screen.findByText('Both models answered.')).toBeTruthy();
  });

  it('shows other ways in step 1', async () => {
    open('#/welcome/1');
    fireEvent.click(await screen.findByRole('radio', { name: /Use my home server/ }));
    expect(
      screen.getByRole('link', { name: 'Sign in to a home server' }).getAttribute('href'),
    ).toBe('#/sign-in');
    expect(screen.queryByText('Your OpenRouter key')).toBeNull();
  });

  it('step 2 claims nothing is connected when the server says nothing is', async () => {
    signedIn();
    const api = createMockApi();
    openWith({ ...api, connections: async () => ({ apps: [], machines: [] }) }, '#/welcome/2');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connect the apps you use.' }),
    ).toBeTruthy();
    // A suggestion is not a connection: the list must not say otherwise.
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.getByRole('link', { name: 'Connect Gmail' })).toBeTruthy();
  });

  it('step 2 lists apps and can be skipped', async () => {
    signedIn();
    open('#/welcome/2');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connect the apps you use.' }),
    ).toBeTruthy();
    // The mock server reports all three as connected, so all three say so.
    expect(screen.getAllByText('Connected')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Skip for now' }).getAttribute('href')).toBe(
      '#/welcome/3',
    );
    // Nothing is left to connect, so no row offers to.
    expect(screen.queryByRole('link', { name: 'Connect Notion' })).toBeNull();
  });

  it('step 2 asks the server nothing without a session, and claims nothing', async () => {
    let asked = false;
    const api = createMockApi();
    openWith(
      {
        ...api,
        connections: async () => {
          asked = true;
          return { apps: [], machines: [] };
        },
      },
      '#/welcome/2',
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Connect the apps you use.' }),
    ).toBeTruthy();
    // A 401 here would send the person to sign-in mid-setup, so the call is never made.
    expect(asked).toBe(false);
    expect(screen.queryByText('Connected')).toBeNull();
    expect(window.location.hash).toBe('#/welcome/2');
  });

  it('step 3 starts a task and opens it', async () => {
    window.localStorage.removeItem('remy.onboarded');
    open('#/welcome/3');
    const start = (await screen.findByRole('button', { name: 'Ask Remy' })) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Find three flights to Lisbon/ }));
    expect((screen.getByLabelText('What you need done') as HTMLTextAreaElement).value).toBe(
      'Find three flights to Lisbon under £350',
    );
    fireEvent.click(start);
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/tasks\/task_mock/));
    expect(window.localStorage.getItem('remy.onboarded')).toBe('true');
  });

  it('skipping setup marks the visit as done and opens Home', async () => {
    window.localStorage.removeItem('remy.onboarded');
    open('#/welcome/2');
    fireEvent.click(await screen.findByRole('button', { name: 'Skip setup and open Remy' }));
    expect(window.localStorage.getItem('remy.onboarded')).toBe('true');
    expect(window.location.hash).toBe('#/');
  });

  for (const step of ['1', '2', '3']) {
    it(`has no basic accessibility problems in step ${step}`, async () => {
      open(`#/welcome/${step}`);
      await screen.findByRole('heading', { level: 1 });
      expect(a11yProblems()).toEqual([]);
    });
  }
});

describe('first visit', () => {
  it('sends a visit with no token from any page to sign-in, never to fake data', async () => {
    window.history.replaceState({}, '', '/');
    for (const start of ['#/', '#/tasks', '#/settings']) {
      cleanup();
      open(start);
      await waitFor(() => expect(window.location.hash).toBe('#/sign-in'));
    }
  });

  it('does not send someone who signed in or already finished', async () => {
    window.localStorage.removeItem('remy.onboarded');
    window.localStorage.setItem('remy.token', 'abc');
    open('#/');
    await screen.findByRole('navigation', { name: 'Main' });
    expect(window.location.hash).toBe('#/');
  });

  it('leaves a visit that is already done alone', async () => {
    open('#/'); // the test setup marks the visit as done
    await screen.findByRole('navigation', { name: 'Main' });
    expect(window.location.hash).toBe('#/');
  });
});
