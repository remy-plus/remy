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
    expect(screen.getByRole('button', { name: 'New webhook' })).toBeTruthy();
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('region', { name: 'Recurring' });
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('complementary')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Schedules' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Brain' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Activity' }).getAttribute('aria-current')).toBeNull();
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
    for (const s of screen.getAllByRole('switch'))
      expect(s.getAttribute('aria-label')).toBeTruthy();
  });
});

describe('Webhooks', () => {
  it('shows the server sentence when a name is refused', async () => {
    open();
    await screen.findByRole('region', { name: 'Webhooks' });
    fireEvent.click(screen.getByRole('button', { name: 'New webhook' }));
    expect(
      screen.getByText(
        /Whatever the caller sends is treated as information, never as instructions/,
      ),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad Name' } });
    fireEvent.change(screen.getByLabelText('What should Remy do with each call?'), {
      target: { value: 'Check it' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create the webhook' }));
    expect(await screen.findByText(/1 to 40 characters/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create the webhook' }));
    expect(await screen.findByText('Give the webhook a name.')).toBeTruthy();
  });

  it('shows the address and a curl that reads the token from the terminal', async () => {
    open(
      '#/schedules',
      apiWith({
        addWebhook: async ({ name }) => ({
          id: name,
          name,
          url: `POST http://127.0.0.1:7788/hook/${name}`,
          detail: '',
          enabled: false,
        }),
      }),
    );
    await screen.findByRole('region', { name: 'Webhooks' });
    fireEvent.click(screen.getByRole('button', { name: 'New webhook' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'deploys' } });
    fireEvent.change(screen.getByLabelText('What should Remy do with each call?'), {
      target: { value: 'Check it' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create the webhook' }));
    expect(await screen.findByText('The webhook deploys is created.')).toBeTruthy();
    const curl = screen.getByText(/curl -X POST/).textContent ?? '';
    expect(curl).toContain('curl -X POST http://127.0.0.1:7788/hook/deploys');
    expect(curl).toContain('$(remy webhook token)');
    expect(curl).not.toContain('POST POST');
    expect(screen.getByRole('button', { name: 'Copy the command to call deploys' })).toBeTruthy();
    expect(screen.getByText(/Webhooks are off for now/)).toBeTruthy();
  });

  it('hides the no-webhook note while the form and its success panel are up', async () => {
    const base = createMockApi();
    const api = apiWith({
      // No webhook before or after the create, so the note shows unless it is hidden.
      schedules: async () => ({ ...(await base.schedules()), webhooks: [] }),
      addWebhook: async ({ name }) => ({
        id: name,
        name,
        url: `POST http://127.0.0.1:7788/hook/${name}`,
        detail: '',
        enabled: false,
      }),
    });
    open('#/schedules', api);
    await screen.findByRole('region', { name: 'Webhooks' });
    expect(screen.getByText('No webhook yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New webhook' }));
    const form = screen.getByRole('form', { name: 'New webhook' });
    expect(screen.queryByText('No webhook yet.')).toBeNull();
    expect(screen.queryByText('A webhook lets an outside service start a job.')).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('No webhook yet.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New webhook' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'deploys' } });
    fireEvent.change(screen.getByLabelText('What should Remy do with each call?'), {
      target: { value: 'Check it' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create the webhook' }));
    expect(await screen.findByText('The webhook deploys is created.')).toBeTruthy();
    expect(screen.queryByText('No webhook yet.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByText('No webhook yet.')).toBeTruthy();
  });

  it('asks before removing a webhook, and removes it on yes', async () => {
    const removed: string[] = [];
    open('#/schedules', apiWith({ removeWebhook: async (n) => void removed.push(n) }));
    await screen.findByRole('region', { name: 'Webhooks' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove new-invoice' }));
    expect(removed).toEqual([]);
    expect(await screen.findByText('Calls to this address will stop starting tasks.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep it' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(removed).toEqual(['new-invoice']));
  });
});
