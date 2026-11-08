import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const open = () => {
  window.location.hash = '#/brain';
  return render(
    <ApiProvider api={createMockApi()}>
      <App />
    </ApiProvider>,
  );
};
const node = (name: RegExp | string) =>
  screen.getByRole('button', { name: new RegExp(`^${name}, `) });
const panel = () => screen.getByRole('complementary', { name: 'Selected note' });

describe('Brain', () => {
  it('selects Dana first and shows her note and her links', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 2, name: 'Dana Ferreira' })).toBeTruthy();
    expect(within(panel()).getByText(/Prefers email before 10:00/)).toBeTruthy();
    expect(within(panel()).getByText('41 links')).toBeTruthy();
    const linked = within(panel()).getByRole('region', { name: 'Linked to' });
    expect(within(linked).getByRole('button', { name: /Audit 2026/ })).toBeTruthy();
    expect(node('Dana Ferreira').getAttribute('aria-pressed')).toBe('true');
  });

  it('every node is a named button and selecting one fills the panel', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Dana Ferreira' });
    fireEvent.click(node('Acme'));
    expect(screen.getByRole('heading', { level: 2, name: 'Acme' })).toBeTruthy();
    expect(within(panel()).getByText(/Largest vendor/)).toBeTruthy();
    expect(within(panel()).getByRole('button', { name: 'Ask about Acme' })).toBeTruthy();
    expect(node('Acme').getAttribute('aria-pressed')).toBe('true');
    expect(node('Dana Ferreira').getAttribute('aria-pressed')).toBe('false');
  });

  it('moves between linked notes with the arrow keys', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Dana Ferreira' });
    const dana = node('Dana Ferreira');
    dana.focus();
    fireEvent.keyDown(dana, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(node('Priya Nair'));
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(node('Working hours 09:00 to 17:30'));
    // Working hours links only to Priya, who is up and to the left: nothing to the right.
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(node('Working hours 09:00 to 17:30'));
    // Enter or Space presses the button, which selects it.
    fireEvent.click(document.activeElement as Element);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Working hours 09:00 to 17:30' }),
    ).toBeTruthy();
  });

  it('filters by kind with the chips', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Dana Ferreira' });
    const graphNodes = () =>
      screen.getAllByRole('button', { name: /, (Person|Project|How-to|Fact), \d+ links$/ });
    expect(graphNodes()).toHaveLength(12);
    fireEvent.click(screen.getByRole('button', { name: /^People 38$/ }));
    expect(graphNodes()).toHaveLength(2);
    expect(screen.getByRole('button', { name: /^People 38$/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: /^How-tos 17$/ }));
    expect(graphNodes()).toHaveLength(3);
    // Dana is hidden, so the panel moves to the first note that is shown.
    expect(screen.queryByRole('heading', { level: 2, name: 'Dana Ferreira' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^All 1,204$/ }));
    expect(graphNodes()).toHaveLength(12);
  });

  it('searches and says when nothing matches', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Dana Ferreira' });
    const box = screen.getByRole('searchbox', { name: 'Search notes' });
    fireEvent.change(box, { target: { value: 'lisbon' } });
    expect(
      screen.getAllByRole('button', { name: /, (Person|Project|How-to|Fact), \d+ links$/ }).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Priya Nair, / })).toBeNull();
    fireEvent.change(box, { target: { value: 'zzzz' } });
    expect(screen.getByText('No note matches.')).toBeTruthy();
    expect(screen.getByText('No note is selected.')).toBeTruthy();
  });

  it('edits and deletes a note', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Dana Ferreira' });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Note text' }), {
      target: { value: 'Leads finance.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByText('Leads finance.')).toBeTruthy();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Delete note' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Delete “Dana Ferreira”/);
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete it' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Dana Ferreira, / })).toBeNull(),
    );
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('heading', { level: 2, name: 'Dana Ferreira' });
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Brain' })).toBeTruthy();
    for (const b of screen.getAllByRole('button')) {
      expect(b.getAttribute('aria-label') || b.textContent?.trim()).toBeTruthy();
    }
  });
});
