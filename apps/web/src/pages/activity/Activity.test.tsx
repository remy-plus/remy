import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { Activity, plainState } from './Activity.tsx';

const show = () =>
  render(
    <ApiProvider api={createMockApi()}>
      <Activity />
    </ApiProvider>,
  );

describe('Activity', () => {
  it('groups jobs into working now, waiting for you and earlier', async () => {
    show();
    const waiting = await screen.findByRole('region', { name: 'Waiting for you' });
    expect(within(waiting).getAllByRole('link').length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: 'Working now' })).toBeTruthy();
    const earlier = screen.getByRole('region', { name: 'Earlier' });
    expect(within(earlier).getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('links each row to its job and uses plain words', async () => {
    show();
    await screen.findByRole('region', { name: 'Earlier' });
    const shortcuts = screen.getByRole('navigation', { name: 'Shortcuts' });
    for (const a of screen.getAllByRole('link'))
      if (!shortcuts.contains(a)) expect(a.getAttribute('href')).toMatch(/^#\/tasks\/[^/]+$/);
    const all = document.body.textContent ?? '';
    expect(all).not.toMatch(/\d{1,2}:\d{2}:\d{2}/);
    expect(all).not.toMatch(/waiting_approval|succeeded|cancelled/);
  });

  it('gives an empty list a way out instead of a dead end', async () => {
    const api = { ...createMockApi(), listTasks: async () => [] };
    render(
      <ApiProvider api={api}>
        <Activity />
      </ApiProvider>,
    );
    expect(await screen.findByText('Nothing here yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ask Remy for something' }).getAttribute('href')).toBe(
      '#/',
    );
  });

  it('names every state without jargon', () => {
    expect(plainState('running')).toBe('Working');
    expect(plainState('waiting_approval')).toBe('Waiting for you');
    expect(plainState('waiting_user')).toBe('Waiting for you');
    expect(plainState('succeeded')).toBe('Done');
    for (const s of ['failed', 'cancelled', 'paused'] as const)
      expect(plainState(s)).toBe("Didn't finish");
  });
});
