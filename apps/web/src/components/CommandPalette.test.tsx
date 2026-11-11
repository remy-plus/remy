import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../App.tsx';
import { a11yProblems } from '../a11y.testing.ts';
import { ApiProvider } from '../api/index.tsx';
import { createMockApi } from '../api/mock.ts';
import type { RemyApi } from '../api/types.ts';

afterEach(() => {
  window.location.hash = '';
});

/** A failure the way the adapter sends one: a status, and no words of its own. */
const status = (code: number) => Object.assign(new Error(''), { status: code });

const app = (api: RemyApi = createMockApi()) => {
  window.location.hash = '#/tasks';
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};
const ctrlK = () => fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
const box = () => screen.findByRole('combobox', { name: 'Search or tell Remy what to do' });
const rows = () => screen.getAllByRole('option').map((o) => o.textContent);

describe('CommandPalette', () => {
  it('is closed until Ctrl+K, and opens with the combobox ready', async () => {
    app();
    expect(screen.queryByRole('combobox')).toBeNull();
    ctrlK();
    const input = await box();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    // Ctrl+K again closes it.
    ctrlK();
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('opens from the remy:palette event, and from Cmd+K', async () => {
    app();
    act(() => {
      window.dispatchEvent(new Event('remy:palette'));
    });
    await box();
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
    fireEvent.keyDown(window, { key: 'K', metaKey: true });
    await box();
  });

  it('groups results by what they do and filters tasks as you type', async () => {
    app();
    ctrlK();
    const input = await box();
    fireEvent.change(input, { target: { value: 'dana' } });
    const groups = within(screen.getByRole('listbox')).getAllByRole('group');
    expect(groups).toHaveLength(3);
    const labels = groups.map((g) => within(g).getAllByRole('option').length);
    expect(labels.every((n) => n > 0)).toBe(true);
    const has = (text: string) => rows().some((r) => r?.startsWith(text));
    expect(has("Book Dana's flights")).toBe(true);
    expect(has('dana?')).toBe(true);
    expect(has('Rename invoices')).toBe(false);
  });

  it('offers a way out when nothing matches: ask anyway, or clear the search', async () => {
    app();
    ctrlK();
    const input = await box();
    fireEvent.change(input, { target: { value: 'zzzz' } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    expect(screen.getByRole('option', { name: /Ask Remy to do “zzzz”/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('option', { name: /Clear the search/ }));
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('option', { name: /Turn on quiet mode/ })).toBeTruthy();
    expect(screen.queryByText(/Nothing matches/)).toBeNull();
  });

  it('has a Clear control whenever the search is narrowed', async () => {
    app();
    ctrlK();
    const input = await box();
    expect(screen.queryByRole('button', { name: 'Clear the search' })).toBeNull();
    fireEvent.change(input, { target: { value: 'dana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear the search' }));
    expect((input as HTMLInputElement).value).toBe('');
    expect(screen.queryByRole('button', { name: 'Clear the search' })).toBeNull();
    expect(screen.getByRole('option', { name: /Turn on quiet mode/ })).toBeTruthy();
  });

  it('moves with the arrow keys, names the active row, and wraps', async () => {
    app();
    ctrlK();
    const input = await box();
    const options = () => screen.getAllByRole('option');
    const activeId = () => input.getAttribute('aria-activedescendant');
    expect(activeId()).toBe(options()[0]?.id);
    expect(options()[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(activeId()).toBe(options()[1]?.id);
    expect(options()[1]?.getAttribute('aria-selected')).toBe('true');
    expect(options()[0]?.getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(activeId()).toBe(options().at(-1)?.id);
  });

  it('Enter opens the chosen task and closes', async () => {
    app();
    ctrlK();
    const input = await box();
    fireEvent.change(input, { target: { value: 'invoices' } });
    // The task row is the one that is not "ask" or "do something".
    const tasks = screen.getByRole('group', { name: 'Jobs' });
    const row = within(tasks).getByRole('option', { name: /Rename invoices/ });
    fireEvent.mouseMove(row);
    expect(input.getAttribute('aria-activedescendant')).toBe(row.id);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(window.location.hash).toBe('#/tasks/task_rename');
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());
  });

  it('Enter on an ask row starts a task; Tab tells Remy to do the typed words', async () => {
    app();
    ctrlK();
    let input = await box();
    fireEvent.change(input, { target: { value: 'what is due friday' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/tasks\/task_mock1/));
    await waitFor(() => expect(screen.queryByRole('combobox')).toBeNull());

    ctrlK();
    input = await box();
    fireEvent.change(input, { target: { value: 'tidy my downloads' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/tasks\/task_mock2/));
  });

  it('says why a job did not start', async () => {
    app({ ...createMockApi(), startTask: () => Promise.reject(status(402)) });
    ctrlK();
    const input = await box();
    fireEvent.change(input, { target: { value: 'tidy my downloads' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      "This month's spending limit is reached. Raise it in Settings, under Spending, or wait until next month.",
    );
  });

  it('says when your jobs could not be loaded', async () => {
    app({ ...createMockApi(), listTasks: () => Promise.reject(status(500)) });
    ctrlK();
    await box();
    const dialog = screen.getByRole('dialog', { name: 'Command palette' });
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      "Remy's server hit a problem. Try again in a moment.",
    );
  });

  it('Esc closes it', async () => {
    app();
    ctrlK();
    const input = await box();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('runs an action: quiet mode', async () => {
    app();
    ctrlK();
    const input = await box();
    fireEvent.change(input, { target: { value: 'quiet' } });
    fireEvent.click(screen.getByRole('option', { name: /Turn on quiet mode/ }));
    expect(window.location.hash).toBe('#/quiet');
    expect(window.localStorage.getItem('remy.quiet')).toBe('true');
  });

  it('has no basic accessibility problems while open', async () => {
    app();
    ctrlK();
    await box();
    expect(a11yProblems()).toEqual([]);
  });
});
