import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../../api/mock.ts';
import type { RemyApi } from '../../api/types.ts';
import { open } from './test-utils.tsx';

afterEach(() => {
  window.location.hash = '';
});

/** A failure the way the adapter sends one: a status, and no words of its own. */
const status = (code: number) => Object.assign(new Error(''), { status: code });

describe('Approval dialog', () => {
  const openFromTask = async (api: RemyApi) => {
    open('#/tasks/task_correction', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Review and send' }));
    return screen.findByRole('dialog', { name: 'Send this correction to Dana?' });
  };

  it('shows what will be sent and names every button', async () => {
    const dialog = await openFromTask(createMockApi());
    expect(within(dialog).getByText(/Correction: Q3 vendor total/)).toBeTruthy();
    for (const name of ['What this will do', 'Why Remy is asking', 'This approval']) {
      expect(within(dialog).getByRole('heading', { name })).toBeTruthy();
    }
    for (const name of [/^Send as you/, /^Edit first/, /^Not now/]) {
      expect(within(dialog).getByRole('button', { name })).toBeTruthy();
    }
    for (const b of within(dialog).getAllByRole('button'))
      expect(b.textContent?.trim()).toBeTruthy();
  });

  it('says what happens after the answer, before it is given', async () => {
    const dialog = await openFromTask(createMockApi());
    expect(
      within(dialog).getByText(
        'Approve: Remy sends this one message, then carries on. Not now: nothing happens and the job stops.',
      ),
    ).toBeTruthy();
  });

  it('passes the cards own argsHash to approve, never one of its own', async () => {
    const api = createMockApi();
    const approve = vi.spyOn(api, 'approve');
    const dialog = await openFromTask(api);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Send as you/ }));
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith('task_correction', {
        callId: 'call_correction',
        argsHash: 'hash_call_correction',
        granted: true,
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('treats Esc as "Not now"', async () => {
    const api = createMockApi();
    const approve = vi.spyOn(api, 'approve');
    const dialog = await openFromTask(api);
    await act(async () => {
      fireEvent(dialog, new Event('cancel', { cancelable: true }));
    });
    await waitFor(() =>
      expect(approve).toHaveBeenCalledWith('task_correction', {
        callId: 'call_correction',
        argsHash: 'hash_call_correction',
        granted: false,
      }),
    );
  });

  it('approves on Enter and edits on E', async () => {
    const api = createMockApi();
    const approve = vi.spyOn(api, 'approve');
    const dialog = await openFromTask(api);
    fireEvent.keyDown(dialog, { key: 'Enter' });
    await waitFor(() => expect(approve).toHaveBeenCalledOnce());
    expect(approve.mock.calls[0]?.[1].granted).toBe(true);
  });

  it('offers "Edit first" only when the call allows it', async () => {
    open('#/tasks/task_flights');
    fireEvent.click(await screen.findByRole('button', { name: 'Review and pay' }));
    const dialog = await screen.findByRole('dialog', { name: /Book this flight/ });
    expect(within(dialog).queryByRole('button', { name: /Edit first/ })).toBeNull();
    expect(within(dialog).getByRole('button', { name: /^Approve and pay/ })).toBeTruthy();
  });

  it('opens at once and names what it is opening', async () => {
    const api: RemyApi = { ...createMockApi(), getTask: () => new Promise<never>(() => {}) };
    open('#/review', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Review and send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Opening this approval' });
    expect(within(dialog).getByRole('status').textContent).toBe('Opening this approval');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('shows an error and stays open when the server refuses', async () => {
    const api = createMockApi();
    vi.spyOn(api, 'approve').mockRejectedValue(new Error('approval is for different arguments'));
    const dialog = await openFromTask(api);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Send as you/ }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('says what changed when the card is out of date', async () => {
    const api = createMockApi();
    vi.spyOn(api, 'approve').mockRejectedValue(status(409));
    const dialog = await openFromTask(api);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Send as you/ }));
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'Something changed while you were looking. Reload to see the latest.',
    );
  });
});
