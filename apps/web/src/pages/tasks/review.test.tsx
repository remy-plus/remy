import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createMockApi } from '../../api/mock.ts';
import type { RemyApi, ReviewData } from '../../api/types.ts';
import { checkLandmarks, open } from './test-utils.tsx';

afterEach(() => {
  window.location.hash = '';
});

/** The mock's overnight review, with one part changed. */
const reviewWith = async (patch: Partial<ReviewData>): Promise<RemyApi> => {
  const base = await createMockApi().review();
  return { ...createMockApi(), review: async () => ({ ...base, ...patch }) };
};

/** A failure the way the adapter sends one: a status, and no words of its own. */
const status = (code: number) => Object.assign(new Error(''), { status: code });

describe('Overnight review', () => {
  it('shows the summary, the timeline and what needs you', async () => {
    open('#/review');
    expect(await screen.findByRole('heading', { level: 1, name: /Three tasks ran/ })).toBeTruthy();
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(8);
    const needs = screen.getByRole('complementary', { name: 'Needs you' });
    expect(within(needs).getByText('Reminder to Acme about invoice 0412')).toBeTruthy();
    expect(within(needs).getByText(/How much Remy does on its own/)).toBeTruthy();
    expect(within(needs).getByText("Work on its own while I'm away")).toBeTruthy();
    checkLandmarks();
  });

  it('opens the approval from the card', async () => {
    open('#/review');
    fireEvent.click(await screen.findByRole('button', { name: 'Review and send' }));
    expect(await screen.findByRole('dialog', { name: 'Send this reminder to Acme?' })).toBeTruthy();
  });

  it('says it worked when the reminder is approved', async () => {
    open('#/review');
    fireEvent.click(await screen.findByRole('button', { name: 'Review and send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send this reminder to Acme?' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Send as you/ }));
    expect(await screen.findByText('Approved. Remy is sending it.')).toBeTruthy();
  });

  it('says nothing was sent when the person says not now', async () => {
    open('#/review');
    fireEvent.click(await screen.findByRole('button', { name: 'Not now' }));
    expect(await screen.findByText('Not now. Nothing was sent.')).toBeTruthy();
    expect(screen.getByText('Nothing is waiting for you.')).toBeTruthy();
  });

  it('offers a way forward when nothing is waiting', async () => {
    open('#/review', await reviewWith({ needs: null }));
    expect(await screen.findByText('Nothing is waiting for you.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See what Remy did' }).getAttribute('href')).toBe(
      '#/activity',
    );
    expect(screen.getByRole('link', { name: 'Ask Remy for something' }).getAttribute('href')).toBe(
      '#/',
    );
  });

  it('names what it is loading instead of saying "Loading"', () => {
    const api: RemyApi = { ...createMockApi(), review: () => new Promise<never>(() => {}) };
    open('#/review', api);
    expect(screen.getByText('Loading what needs your look')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/^Loading$/);
  });

  it('says why the review could not be loaded, and offers to try again', async () => {
    const api: RemyApi = { ...createMockApi(), review: () => Promise.reject(status(500)) };
    open('#/review', api);
    expect(await screen.findByText(/Remy's server hit a problem/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See what Remy has done' })).toBeTruthy();
  });

  it('never shows military time', async () => {
    open('#/review');
    await screen.findByRole('heading', { level: 1, name: /Three tasks ran/ });
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    // Every time on the page is a 12-hour one: nothing is left as "23:10".
    expect(text.match(/\d{1,2}:\d{2}(?!\s?(AM|PM))/gi)).toBeNull();
  });
});
