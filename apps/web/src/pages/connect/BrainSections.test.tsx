import { render, screen, within } from '@testing-library/react';
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

const current = (nav: HTMLElement) =>
  within(nav)
    .getAllByRole('link')
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.textContent);

describe('Brain sections row', () => {
  it('on Notes, links Skills and Scheduled jobs and marks Notes current', async () => {
    open('#/brain');
    const nav = await screen.findByRole('navigation', { name: 'Brain sections' });
    expect(current(nav)).toEqual(['Notes']);
    expect(within(nav).getByRole('link', { name: 'Skills' }).getAttribute('href')).toBe('#/skills');
    expect(within(nav).getByRole('link', { name: 'Scheduled jobs' }).getAttribute('href')).toBe(
      '#/schedules',
    );
  });

  it('on Skills, marks Skills current', async () => {
    open('#/skills');
    const nav = await screen.findByRole('navigation', { name: 'Brain sections' });
    expect(current(nav)).toEqual(['Skills']);
  });

  it('on Scheduled jobs, marks Scheduled jobs current', async () => {
    open('#/schedules');
    const nav = await screen.findByRole('navigation', { name: 'Brain sections' });
    expect(current(nav)).toEqual(['Scheduled jobs']);
  });
});
