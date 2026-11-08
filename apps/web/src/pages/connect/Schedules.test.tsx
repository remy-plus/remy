import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const open = (hash = '#/schedules') => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={createMockApi()}>
      <App />
    </ApiProvider>,
  );
};

const on = (name: string) => (screen.getByRole('switch', { name }) as HTMLInputElement).checked;

describe('Schedules', () => {
  it('lists the schedules, the next 24 hours and the webhook', async () => {
    open();
    const recurring = await screen.findByRole('region', { name: 'Recurring' });
    expect(within(recurring).getAllByRole('heading', { level: 3 })).toHaveLength(4);
    const next = screen.getByRole('region', { name: 'Next 24 hours' });
    expect(within(next).getAllByRole('listitem')).toHaveLength(3);
    expect(within(next).getByText('in 18 min')).toBeTruthy();
    const hooks = screen.getByRole('region', { name: 'Webhooks' });
    expect(
      within(hooks).getByText(/POST http:\/\/127\.0\.0\.1:7788\/hook\/new-invoice/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New schedule' }).getAttribute('href')).toBe(
      '#/schedules/new',
    );
  });

  it('turns a schedule off with a real switch', async () => {
    open();
    fireEvent.click(await screen.findByRole('switch', { name: 'Watch Lisbon fares' }));
    await waitFor(() => expect(on('Watch Lisbon fares')).toBe(false));
    expect(on('Slack summary')).toBe(false);
    expect(screen.getByRole('link', { name: 'Fix it' }).getAttribute('href')).toBe('#/connections');
  });

  it('runs a schedule now and offers the task', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Run now: Rename invoices' }));
    expect(await screen.findByText('Started Rename invoices.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the task' }).getAttribute('href')).toMatch(
      /^#\/tasks\/task_mock_run/,
    );
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('region', { name: 'Recurring' });
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Schedules' })).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
    for (const s of screen.getAllByRole('switch'))
      expect(s.getAttribute('aria-label')).toBeTruthy();
  });
});
