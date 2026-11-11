import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiError } from '../../api/http.ts';
import { ApiProvider, type RemyApi } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { whenPhrase, whenWords } from './NewSchedule.tsx';

afterEach(() => {
  window.location.hash = '';
});

const apiWith = (patch: Partial<RemyApi>): RemyApi => ({ ...createMockApi(), ...patch });

const open = (api: RemyApi = createMockApi()) => {
  window.location.hash = '#/schedules/new';
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

const base = {
  often: 'Weekly' as const,
  day: 'Monday',
  monthDay: 1,
  time: '08:30',
  custom: '',
};

describe('New schedule', () => {
  it('writes the phrase the scheduler reads', () => {
    expect(whenPhrase(base)).toBe('every Monday at 08:30');
    expect(whenPhrase({ ...base, often: 'Hourly' })).toBe('every hour');
    expect(whenPhrase({ ...base, often: 'Monthly', monthDay: 22 })).toBe(
      'on the 22nd of every month at 08:30',
    );
    expect(whenPhrase({ ...base, often: 'Monthly', monthDay: 11 })).toBe(
      'on the 11th of every month at 08:30',
    );
    expect(whenPhrase({ ...base, often: 'Custom', custom: ' every 2 hours ' })).toBe(
      'every 2 hours',
    );
  });

  it('says the same phrase back with a 12-hour clock, never military time', () => {
    expect(whenWords(base)).toMatch(/^every Monday at 8:30\s?AM$/);
    expect(whenWords({ ...base, time: '16:00' })).toMatch(/^every Monday at 4:00\s?PM$/);
    expect(whenWords({ ...base, often: 'Daily', time: '00:15' })).toMatch(
      /^every day at 12:15\s?AM$/,
    );
    expect(whenWords({ ...base, often: 'Hourly' })).toBe('every hour');
    expect(whenWords({ ...base, often: 'Custom', custom: ' every 2 hours ' })).toBe(
      'every 2 hours',
    );
  });

  it('has a segmented control as a radiogroup', async () => {
    open();
    const group = await screen.findByRole('radiogroup', { name: 'How often' });
    expect(group).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Weekly' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Hourly' }));
    expect((screen.getByRole('radio', { name: 'Hourly' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Weekly' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByLabelText('At')).toBeNull();
  });

  it('says what the time means, in plain words', async () => {
    open();
    await screen.findByRole('radiogroup', { name: 'How often' });
    expect(screen.getByText(/Remy runs this every Monday at 8:30/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('At'), { target: { value: '16:00' } });
    expect(screen.getByText(/Remy runs this every Monday at 4:00/)).toBeTruthy();
  });

  it('asks for the task before creating, then says the schedule is created', async () => {
    open();
    const box = await screen.findByRole('textbox', { name: 'What should Remy do?' });
    fireEvent.click(screen.getByRole('button', { name: 'Create the schedule' }));
    await waitFor(() => expect(box.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Say what Remy should do.',
    );
    expect(window.location.hash).toBe('#/schedules/new');
    fireEvent.change(box, { target: { value: 'Summarise Dana’s emails' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create the schedule' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'The schedule is created.' }),
    ).toBeTruthy();
    expect(screen.getByText(/Summarise Dana’s emails/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See your schedules' }).getAttribute('href')).toBe(
      '#/schedules',
    );
  });

  it('says which status stopped the schedule, in the server’s own words', async () => {
    open(apiWith({ createSchedule: () => Promise.reject(new ApiError(402, '')) }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'What should Remy do?' }), {
      target: { value: 'Do a thing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create the schedule' }));
    expect(await screen.findByText(/spending limit is reached/)).toBeTruthy();
  });

  it('rejects a time that is not a time', async () => {
    open();
    fireEvent.change(await screen.findByRole('textbox', { name: 'What should Remy do?' }), {
      target: { value: 'Do a thing' },
    });
    const time = screen.getByLabelText('At');
    fireEvent.change(time, { target: { value: '8pm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create the schedule' }));
    await waitFor(() => expect(time.getAttribute('aria-invalid')).toBe('true'));
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('radiogroup', { name: 'How often' });
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'New schedule' })).toBeTruthy();
    expect(screen.getByText(/How much Remy does on its own/).textContent).toMatch(
      /Handle routine things/,
    );
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
  });
});
