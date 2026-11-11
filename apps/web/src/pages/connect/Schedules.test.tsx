import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiError } from '../../api/http.ts';
import { ApiProvider, type RemyApi } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { plainTime } from './Schedules.tsx';

afterEach(() => {
  window.location.hash = '';
});

const apiWith = (patch: Partial<RemyApi>): RemyApi => ({ ...createMockApi(), ...patch });

const open = (hash = '#/schedules', api: RemyApi = createMockApi()) => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

const on = (name: string) => (screen.getByRole('switch', { name }) as HTMLInputElement).checked;

describe('Schedules', () => {
  it('says a server time the way a person reads a clock', () => {
    expect(plainTime('Fridays at 16:00')).toMatch(/^Fridays at 4:00\s?PM$/);
    expect(plainTime('1st of month, 09:00')).toMatch(/^1st of month, 9:00\s?AM$/);
    expect(plainTime('tomorrow 08:30')).toMatch(/^tomorrow 8:30\s?AM$/);
    expect(plainTime('Every hour')).toBe('Every hour');
    expect(plainTime('next in 18 min')).toBe('next in 18 min');
  });

  it('lists the schedules, the next 24 hours and the webhook', async () => {
    open();
    const recurring = await screen.findByRole('region', { name: 'Recurring' });
    expect(within(recurring).getAllByRole('heading', { level: 3 })).toHaveLength(4);
    expect(within(recurring).getByText(/Fridays at 4:00/)).toBeTruthy();
    const next = screen.getByRole('region', { name: 'Next 24 hours' });
    expect(within(next).getAllByRole('listitem')).toHaveLength(3);
    expect(within(next).getByText('in 18 min')).toBeTruthy();
    const hooks = screen.getByRole('region', { name: 'Webhooks' });
    expect(
      within(hooks).getByText(/POST http:\/\/127\.0\.0\.1:7788\/hook\/new-invoice/),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a schedule' }).getAttribute('href')).toBe(
      '#/schedules/new',
    );
  });

  it('says what a schedule’s time means', async () => {
    open();
    const recurring = await screen.findByRole('region', { name: 'Recurring' });
    expect(
      within(recurring).getByText('Times are the clock of the machine Remy runs on.'),
    ).toBeTruthy();
  });

  it('turns a schedule off with a real switch, and says so in its row', async () => {
    open();
    fireEvent.click(await screen.findByRole('switch', { name: 'Watch Lisbon fares' }));
    await waitFor(() => expect(on('Watch Lisbon fares')).toBe(false));
    expect(
      await screen.findByText('Watch Lisbon fares is off. Remy will not run it.'),
    ).toBeTruthy();
    expect(on('Slack summary')).toBe(false);
    expect(screen.getByRole('link', { name: 'Fix it' }).getAttribute('href')).toBe('#/connections');
    fireEvent.click(screen.getByRole('switch', { name: 'Watch Lisbon fares' }));
    expect(await screen.findByText('Watch Lisbon fares is on. Remy runs it on time.')).toBeTruthy();
  });

  it('says which status stopped a change, in the server’s own words', async () => {
    open(
      '#/schedules',
      apiWith({ setScheduleEnabled: () => Promise.reject(new ApiError(429, '')) }),
    );
    fireEvent.click(await screen.findByRole('switch', { name: 'Watch Lisbon fares' }));
    expect(
      await screen.findByText('Too many requests just now. Wait a moment, then try again.'),
    ).toBeTruthy();
  });

  it('runs a schedule now and offers the task', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Run now: Rename invoices' }));
    expect(await screen.findByText('Started Rename invoices.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open the job' }).getAttribute('href')).toMatch(
      /^#\/tasks\/task_mock_run/,
    );
  });

  it('offers a way forward when there is no schedule and no webhook', async () => {
    open(
      '#/schedules',
      apiWith({
        schedules: async () => ({
          schedules: [],
          timeline: [],
          webhooks: [],
          webhooksNote: 'listening on this machine only',
          away: 'Nothing ran while you were away.',
          runsOn: ['this machine'],
          policy: { trust: 'steady', stopAbove: '£0.50' },
        }),
      }),
    );
    expect(await screen.findByText('No schedule yet.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Create a schedule' }).getAttribute('href')).toBe(
      '#/schedules/new',
    );
    expect(screen.getByText('Nothing is due in the next 24 hours.')).toBeTruthy();
    expect(screen.getByText('No webhook yet.')).toBeTruthy();
    // No route creates a webhook, so the screen names the terminal command instead of a fake button.
    expect(screen.getByText(/remy webhook add/)).toBeTruthy();
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('region', { name: 'Recurring' });
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Schedules' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Activity' }).getAttribute('aria-current')).toBe(
      'page',
    );
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
    for (const s of screen.getAllByRole('switch'))
      expect(s.getAttribute('aria-label')).toBeTruthy();
  });
});
