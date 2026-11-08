import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../App.tsx';
import { a11yProblems } from '../../a11y.testing.ts';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';

afterEach(() => {
  window.location.hash = '';
});

const open = () => {
  window.location.hash = '#/quiet';
  render(
    <ApiProvider api={createMockApi()}>
      <App />
    </ApiProvider>,
  );
};

describe('Quiet', () => {
  it('turns quiet mode on and says what still gets through', async () => {
    open();
    expect(await screen.findByRole('heading', { level: 1, name: 'Quiet.' })).toBeTruthy();
    expect(window.localStorage.getItem('remy.quiet')).toBe('true');
    expect(await screen.findByText(/2 need your OK/)).toBeTruthy();
    expect(screen.getByText(/Quiet mode · until 07:00/)).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  it('links to the approval waiting and back to Home', async () => {
    open();
    const review = await screen.findByRole('link', { name: 'Review the approvals' });
    expect(review.getAttribute('href')).toMatch(/^#\/tasks\/task_/);
    expect(screen.getByRole('link', { name: 'Open Remy' }).getAttribute('href')).toBe('#/');
  });

  it('turns off and goes Home', async () => {
    open();
    await screen.findByRole('heading', { level: 1, name: 'Quiet.' });
    fireEvent.click(screen.getByRole('button', { name: 'turn off' }));
    expect(window.localStorage.getItem('remy.quiet')).toBe('false');
    await waitFor(() => expect(window.location.hash).toBe('#/'));
  });

  it('has no basic accessibility problems', async () => {
    open();
    await screen.findByRole('link', { name: 'Open Remy' });
    expect(a11yProblems()).toEqual([]);
  });
});
