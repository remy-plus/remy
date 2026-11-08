import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { checkLandmarks, open } from './test-utils.tsx';

afterEach(() => {
  window.location.hash = '';
});

describe('Overnight review', () => {
  it('shows the summary, the timeline and what needs you', async () => {
    open('#/review');
    expect(await screen.findByRole('heading', { level: 1, name: /Three tasks ran/ })).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(8);
    const needs = screen.getByRole('complementary', { name: 'Needs you' });
    expect(within(needs).getByText('Reminder to Acme about invoice 0412')).toBeTruthy();
    expect(within(needs).getByText(/Trust was set to/)).toBeTruthy();
    checkLandmarks();
  });

  it('opens the approval from the card', async () => {
    open('#/review');
    fireEvent.click(await screen.findByRole('button', { name: 'Review and send' }));
    expect(await screen.findByRole('dialog', { name: 'Send this reminder to Acme?' })).toBeTruthy();
  });
});
