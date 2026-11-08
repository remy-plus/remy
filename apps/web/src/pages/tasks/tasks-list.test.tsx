import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLandmarks, open } from './test-utils.tsx';

afterEach(() => {
  window.location.hash = '';
});

describe('Tasks list', () => {
  it('groups tasks and filters them with the chips', async () => {
    open('#/tasks');
    await screen.findByRole('heading', { level: 1, name: 'Tasks' });
    const needs = await screen.findByRole('region', { name: 'Needs you' });
    expect(within(needs).getAllByRole('link')).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Running' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Stopped and finished' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Running/ }));
    expect(screen.queryByRole('region', { name: 'Needs you' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Running' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /^Stopped/ }));
    expect(screen.queryByRole('region', { name: 'Running' })).toBeNull();
    const stopped = screen.getByRole('region', { name: 'Stopped and finished' });
    expect(within(stopped).getByText('File the Printer down issue in the IT tracker')).toBeTruthy();
    expect(within(stopped).queryByText('What do I still owe Dana?')).toBeNull(); // finished, not stopped

    fireEvent.click(screen.getByRole('button', { name: /^Needs you/ }));
    expect(screen.getByRole('button', { name: /^Needs you/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('searches by what a task was about and links each row to its task', async () => {
    open('#/tasks');
    await screen.findByRole('region', { name: 'Needs you' });
    fireEvent.change(screen.getByRole('searchbox', { name: /Search tasks/ }), {
      target: { value: 'lisbon' },
    });
    const link = await screen.findByRole('link', { name: /Watching Lisbon fares/ });
    expect(link.getAttribute('href')).toBe('#/tasks/task_fares');
    expect(screen.queryByRole('link', { name: /Rename invoices/ })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: /Search tasks/ }), {
      target: { value: 'zzz' },
    });
    expect(await screen.findByText('No task matches that.')).toBeTruthy();
  });

  it('links the shortcuts and passes the landmark check', async () => {
    open('#/tasks');
    await screen.findByRole('region', { name: 'Needs you' });
    const shortcuts = screen.getByRole('complementary', { name: 'Shortcuts' });
    expect(
      within(shortcuts)
        .getAllByRole('link')
        .map((a) => a.getAttribute('href')),
    ).toEqual(['#/review', '#/schedules', '#/skills']);
    checkLandmarks();
  });
});
