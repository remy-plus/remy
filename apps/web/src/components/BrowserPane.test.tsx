import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/index.tsx';
import { createMockApi } from '../api/mock.ts';
import type { BrowserState, RemyApi } from '../api/types.ts';
import { BrowserPane, FRAME_EVERY_MS, TAKE_OVER_COMMAND } from './BrowserPane.tsx';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const api = (over: Partial<RemyApi>): RemyApi => ({ ...createMockApi(), ...over });
const show = (a: RemyApi, compact = false) =>
  render(
    <ApiProvider api={a}>
      <BrowserPane compact={compact} />
    </ApiProvider>,
  );
const flush = () => act(async () => vi.advanceTimersByTimeAsync(0));
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: hidden ? 'hidden' : 'visible',
  });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('BrowserPane', () => {
  it('shows the page title, the address and a plain status when a page is open', async () => {
    show(api({}));
    await flush();
    expect(screen.getByText('Remy is on northwind.com')).toBeTruthy();
    expect(screen.getByText('Pricing | Northwind')).toBeTruthy();
    expect(screen.getByText('https://northwind.com/pricing')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('src')).toMatch(/^data:image\/svg/);
  });

  it('shows a calm empty state when nothing is open', async () => {
    show(api({ browserState: async () => ({ open: false }) }));
    await flush();
    expect(screen.getByText("Remy isn't using the browser right now")).toBeTruthy();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows no picture when the frame is a 204 (null) even though a page is open', async () => {
    show(api({ browserFrame: async () => null }));
    await flush();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('Loading the page')).toBeTruthy();
  });

  it('says so in plain words when the server cannot be reached, then recovers', async () => {
    const state = vi
      .fn<() => Promise<BrowserState>>()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ open: false });
    show(api({ browserState: state }));
    await flush();
    expect(screen.getByText("Remy's browser can't be reached right now.")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(screen.getByText("Remy isn't using the browser right now")).toBeTruthy();
  });

  it('refreshes about twice a second and revokes the old frame', async () => {
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { revokeObjectURL: revoke }));
    let n = 0;
    const frame = vi.fn(async () => `blob:test/${++n}`);
    show(api({ browserFrame: frame }));
    await flush();
    expect(frame).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(FRAME_EVERY_MS));
    await act(async () => vi.advanceTimersByTimeAsync(FRAME_EVERY_MS));
    expect(frame).toHaveBeenCalledTimes(3);
    expect(revoke).toHaveBeenCalledWith('blob:test/1');
    expect(revoke).toHaveBeenCalledWith('blob:test/2');
    expect(revoke).not.toHaveBeenCalledWith('blob:test/3');
  });

  it('pauses while the tab is hidden and resumes when it is back', async () => {
    const frame = vi.fn(async () => null);
    show(api({ browserFrame: frame }));
    await flush();
    setHidden(true);
    await flush();
    const seen = frame.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(frame.mock.calls.length).toBe(seen);
    setHidden(false);
    await flush();
    expect(frame.mock.calls.length).toBe(seen + 1);
  });

  it('explains taking over in a popover and copies the command', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    show(api({}));
    await flush();
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Take over' }));
    const note = screen.getByRole('note');
    expect(note.textContent).toContain(TAKE_OVER_COMMAND);
    expect(note.textContent).toContain('Remy never types passwords or card numbers.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy command' }));
    });
    expect(writeText).toHaveBeenCalledWith(TAKE_OVER_COMMAND);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('the compact preview has no take-over button', async () => {
    show(api({}), true);
    await flush();
    expect(screen.queryByRole('button', { name: 'Take over' })).toBeNull();
  });
});
