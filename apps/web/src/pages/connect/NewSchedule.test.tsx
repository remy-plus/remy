import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { whenPhrase } from './NewSchedule.tsx';

afterEach(() => {
  window.location.hash = '';
});

const open = () => {
  window.location.hash = '#/schedules/new';
  return render(
    <ApiProvider api={createMockApi()}>
      <App />
    </ApiProvider>,
  );
};

describe('New schedule', () => {
  it('writes the phrase the scheduler reads', () => {
    const base = {
      often: 'Weekly' as const,
      day: 'Monday',
      monthDay: 1,
      time: '08:30',
      custom: '',
    };
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

  it('has a segmented control as a radiogroup', async () => {
    open();
    const group = await screen.findByRole('radiogroup', { name: 'How often' });
    expect(group).toBeTruthy();
    expect((screen.getByRole('radio', { name: 'Weekly' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Hourly' }));
    expect((screen.getByRole('radio', { name: 'Hourly' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'Weekly' }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole('textbox', { name: 'Time' })).toBeNull();
  });

  it('asks for the task before saving, then saves', async () => {
    open();
    const box = await screen.findByRole('textbox', { name: 'What should Remy do?' });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(box.getAttribute('aria-invalid')).toBe('true'));
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Say what Remy should do.',
    );
    expect(window.location.hash).toBe('#/schedules/new');
    fireEvent.change(box, { target: { value: 'Summarise Dana’s emails' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(window.location.hash).toBe('#/schedules'));
  });

  it('rejects a time that is not a time', async () => {
    open();
    fireEvent.change(await screen.findByRole('textbox', { name: 'What should Remy do?' }), {
      target: { value: 'Do a thing' },
    });
    const time = screen.getByRole('textbox', { name: 'Time' });
    fireEvent.change(time, { target: { value: '8pm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    await waitFor(() => expect(time.getAttribute('aria-invalid')).toBe('true'));
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('radiogroup', { name: 'How often' });
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'New schedule' })).toBeTruthy();
    expect(screen.getByText(/trust level/).textContent).toMatch(/steady/);
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
  });
});
