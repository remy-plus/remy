import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import { Activity } from './Activity.tsx';

describe('Activity shortcuts', () => {
  it('links the morning summary and scheduled jobs in plain words', async () => {
    render(
      <ApiProvider api={createMockApi()}>
        <Activity />
      </ApiProvider>,
    );
    const nav = await screen.findByRole('navigation', { name: 'Shortcuts' });
    expect(
      within(nav)
        .getByRole('link', { name: /Morning summary/ })
        .getAttribute('href'),
    ).toBe('#/review');
    expect(
      within(nav)
        .getByRole('link', { name: /Scheduled jobs/ })
        .getAttribute('href'),
    ).toBe('#/schedules');
  });
});
