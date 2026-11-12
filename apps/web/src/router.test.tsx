import { act, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App.tsx';
import { ApiProvider } from './api/index.tsx';
import { createMockApi } from './api/mock.ts';
import { matchRoute, pathOf } from './router.ts';

const app = () => (
  <ApiProvider api={createMockApi()}>
    <App />
  </ApiProvider>
);

const go = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

afterEach(() => {
  window.location.hash = '';
});

describe('matchRoute', () => {
  it('matches every route and reads its params', () => {
    expect(matchRoute('/').name).toBe('home');
    expect(matchRoute('/tasks').name).toBe('tasks');
    expect(matchRoute('/chat/chat_1')).toEqual({ name: 'chat', params: { id: 'chat_1' } });
    expect(matchRoute('/activity').name).toBe('activity');
    expect(matchRoute('/browser').name).toBe('browser');
    expect(matchRoute('/tasks/task_1')).toEqual({ name: 'task', params: { id: 'task_1' } });
    expect(matchRoute('/brain').name).toBe('brain');
    expect(matchRoute('/skills').name).toBe('skills');
    expect(matchRoute('/skills/find').name).toBe('skills-find');
    expect(matchRoute('/schedules').name).toBe('schedules');
    expect(matchRoute('/connections').name).toBe('connections');
    expect(matchRoute('/settings').name).toBe('settings');
    expect(matchRoute('/settings/trust')).toEqual({
      name: 'settings-section',
      params: { section: 'trust' },
    });
    expect(matchRoute('/nope').name).toBe('not-found');
    expect(matchRoute('/tasks/a/b').name).toBe('not-found');
  });

  it('turns a hash into a path', () => {
    expect(pathOf('')).toBe('/');
    expect(pathOf('#/')).toBe('/');
    expect(pathOf('#/tasks/')).toBe('/tasks');
    expect(pathOf('#/tasks?x=1')).toBe('/tasks');
  });
});

describe('App routing', () => {
  const cases: [hash: string, heading: string | RegExp | null, current: string | null][] = [
    ['#/', null, 'Chat'], // the chat page has its own tests
    ['#/chat/chat_week', null, 'Chat'],
    ['#/activity', 'Activity', 'Activity'],
    ['#/browser', 'Browser', 'Browser'],
    ['#/tasks/task_flights', "Book Dana's flights", 'Activity'],
    [
      '#/review',
      'Three tasks ran. One is waiting for you. Nothing was sent or paid without your OK.',
      'Activity',
    ],
    ['#/brain', 'Brain', 'Brain'],
    ['#/skills', 'Skills', 'Brain'],
    ['#/skills/find', 'Find a skill', 'Brain'],
    ['#/schedules', 'Schedules', 'Brain'],
    ['#/schedules/new', 'New schedule', 'Brain'],
    ['#/connections', 'Connections', 'Connections'],
    ['#/settings', 'Settings', 'Settings'],
    ['#/settings/trust', 'Settings', 'Settings'],
  ];
  for (const [hash, heading, current] of cases) {
    it(`renders ${hash}`, async () => {
      window.location.hash = hash;
      render(app());
      if (heading)
        expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      else await screen.findByRole('navigation', { name: 'Main' });
      // The dock marks where you are; a page may also mark its own tabs.
      const marked = within(screen.getByRole('navigation', { name: 'Main' }))
        .getAllByRole('link')
        .filter((a) => a.getAttribute('aria-current') === 'page');
      expect(marked.map((a) => a.textContent)).toEqual(current ? [current] : []);
    });
  }

  it('follows the address bar and moves focus to the page', async () => {
    render(app());
    await screen.findByRole('navigation', { name: 'Main' });
    go('#/brain');
    expect(await screen.findByRole('heading', { level: 1, name: 'Brain' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Brain' }).getAttribute('aria-current')).toBe('page');
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });

  it('shows a plain not-found page', () => {
    window.location.hash = '#/nope';
    render(app());
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeTruthy();
  });

  it('skip link focuses main without changing the route', () => {
    window.location.hash = '#/activity';
    render(app());
    screen.getByRole('link', { name: 'Skip to main content' }).click();
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(window.location.hash).toBe('#/activity');
  });

  it('sends the old tasks address to Activity', async () => {
    window.location.hash = '#/tasks';
    render(app());
    expect(await screen.findByRole('heading', { level: 1, name: 'Activity' })).toBeTruthy();
    expect(window.location.hash).toBe('#/activity');
  });

  it('opens the section that holds a row and finds the row, not the fallback', async () => {
    window.location.hash = '#/settings/folder';
    render(app());
    const row = await screen.findByRole('heading', { level: 3, name: 'Folder Remy may use' });
    expect(document.getElementById('folder')?.contains(row)).toBe(true);
    expect(
      screen.getByRole('heading', { level: 2, name: 'How much Remy does on its own' }),
    ).toBeTruthy();
    expect(screen.queryByText('There is no such section.')).toBeNull();
  });

  it('opens Model and keys at the voice row, not the fallback', async () => {
    window.location.hash = '#/settings/voice';
    render(app());
    const box = await screen.findByRole('textbox', { name: 'Voice id' });
    expect(document.getElementById('voice')?.contains(box)).toBe(true);
    expect(screen.getByRole('heading', { level: 2, name: 'Model and keys' })).toBeTruthy();
    expect(screen.queryByText('There is no such section.')).toBeNull();
  });

  it('opens Search and browsing', async () => {
    window.location.hash = '#/settings/search';
    render(app());
    expect(
      await screen.findByRole('heading', { level: 2, name: 'Search and browsing' }),
    ).toBeTruthy();
    expect(await screen.findByText(/Exa answers searches/)).toBeTruthy();
  });

  it('still says so for an unknown settings section', async () => {
    window.location.hash = '#/settings/nope';
    render(app());
    expect(await screen.findByText('There is no such section.')).toBeTruthy();
  });

  it('shows the dock on app pages and not on the full-page screens', async () => {
    window.location.hash = '#/brain';
    const { unmount } = render(app());
    expect(await screen.findByRole('navigation', { name: 'Main' })).toBeTruthy();
    unmount();
    window.location.hash = '#/sign-in';
    render(app());
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });
});
