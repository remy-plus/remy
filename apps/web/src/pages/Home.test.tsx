import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../App.tsx';
import { ApiProvider } from '../api/index.tsx';
import { createMockApi } from '../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const open = () => {
  window.location.hash = '#/';
  return render(
    <ApiProvider api={createMockApi()}>
      <App />
    </ApiProvider>,
  );
};

describe('Home', () => {
  it('shows the briefing and three sections with accessible names', async () => {
    open();
    expect(
      await screen.findByRole('heading', { level: 1, name: /Three things need you/ }),
    ).toBeTruthy();
    for (const name of ['Needs you', 'Working now', 'Noticed']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    const needs = screen.getByRole('region', { name: 'Needs you' });
    expect(within(needs).getByText('Book TAP London to Lisbon, 17 to 20 Nov')).toBeTruthy();
    expect(within(needs).getByRole('button', { name: 'Approve and book' })).toBeTruthy();
    expect(
      within(screen.getByRole('region', { name: 'Working now' })).getAllByRole('heading', {
        level: 3,
      }),
    ).toHaveLength(4);
    expect(
      within(screen.getByRole('region', { name: 'Noticed' })).getAllByRole('listitem'),
    ).toHaveLength(3);
    expect(screen.getAllByText('1,204', { exact: false }).length).toBeGreaterThan(0);
    expect(screen.getByRole('textbox', { name: /Ask your second brain/ })).toBeTruthy();
  });

  it('says it is showing sample data when the mock runs', async () => {
    open();
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getByText('Sample data')).toBeTruthy();
  });

  it('approves a card and updates the page', async () => {
    open();
    const button = await screen.findByRole('button', { name: 'Approve and book' });
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Approve and book' })).toBeNull(),
    );
    expect(
      await screen.findByRole('heading', { level: 1, name: /Two things need you/ }),
    ).toBeTruthy();
  });

  it('fills the command bar from a suggestion and starts a task on send', async () => {
    open();
    const box = (await screen.findByRole('textbox', {
      name: /Ask your second brain/,
    })) as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Prepare the audit pack' }));
    expect(box.value).toBe('Prepare the audit pack');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/tasks\/task_mock/));
  });
});
