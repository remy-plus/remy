import { act, render, screen } from '@testing-library/react';
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
    expect(matchRoute('/tasks/task_1')).toEqual({ name: 'task', params: { id: 'task_1' } });
    expect(matchRoute('/brain').name).toBe('brain');
    expect(matchRoute('/skills').name).toBe('skills');
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
  const cases: [hash: string, heading: string | RegExp, current: string | null][] = [
    ['#/', /Three things need you/, 'Home'],
    ['#/tasks', 'Tasks', 'Tasks'],
    ['#/tasks/task_9', 'Task', 'Tasks'],
    ['#/brain', 'Brain', 'Brain'],
    ['#/skills', 'Skills', 'Brain'],
    ['#/schedules', 'Schedules', 'Tasks'],
    ['#/connections', 'Connections', 'Connections'],
    ['#/settings', 'Settings', 'Settings'],
    ['#/settings/trust', 'Settings', 'Settings'],
  ];
  for (const [hash, heading, current] of cases) {
    it(`renders ${hash}`, async () => {
      window.location.hash = hash;
      render(app());
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeTruthy();
      const marked = screen
        .getAllByRole('link')
        .filter((a) => a.getAttribute('aria-current') === 'page');
      expect(marked.map((a) => a.textContent)).toEqual(current ? [current] : []);
    });
  }

  it('follows the address bar and moves focus to the page', async () => {
    render(app());
    await screen.findByRole('heading', { level: 1 });
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
    window.location.hash = '#/tasks';
    render(app());
    screen.getByRole('link', { name: 'Skip to main content' }).click();
    expect(document.activeElement).toBe(screen.getByRole('main'));
    expect(window.location.hash).toBe('#/tasks');
  });
});
