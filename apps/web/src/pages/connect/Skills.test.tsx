import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const open = () => {
  window.location.hash = '#/skills';
  return render(
    <ApiProvider api={createMockApi()}>
      <App />
    </ApiProvider>,
  );
};

describe('Skills', () => {
  it('shows the first skill with its steps as a numbered trace and why it exists', async () => {
    open();
    const detail = await screen.findByRole('article', { name: 'monthly-report' });
    expect(within(detail).getAllByRole('listitem')).toHaveLength(4);
    expect(within(detail).getByText('Read the notes file')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Why this skill exists' })).toBeTruthy();
    expect(screen.getByText('Learned from your correction on 6 Oct')).toBeTruthy();
  });

  it('selects another skill', async () => {
    open();
    await screen.findByRole('article', { name: 'monthly-report' });
    fireEvent.click(screen.getByRole('button', { name: /^research/ }));
    expect(await screen.findByRole('article', { name: 'research' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Why this skill exists' })).toBeNull();
    expect(screen.getByRole('button', { name: /^research/ }).getAttribute('aria-current')).toBe(
      'true',
    );
  });

  it('turns a skill off and on, and runs it', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Run it now' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Run it now' }));
    expect(await screen.findByRole('link', { name: 'Open the task' })).toBeTruthy();
  });

  it('saves the suggestion as a skill', async () => {
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Save as a skill' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Suggested' })).toBeNull());
    expect(screen.getByRole('button', { name: /^rename-receipts/ })).toBeTruthy();
  });

  it('has landmarks and no unnamed button', async () => {
    open();
    await screen.findByRole('article');
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Skills' })).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect(b.textContent?.trim()).not.toBe('');
  });
});
