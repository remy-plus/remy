import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../../api/mock.ts';
import type { RemyApi } from '../../api/types.ts';
import { open } from './test-utils.tsx';

afterEach(() => {
  window.location.hash = '';
});

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
    for (const name of [/^Send as you/, /^Edit first/, /^Don't send/]) {
      expect(within(dialog).getByRole('button', { name })).toBeTruthy();
    }
    for (const b of within(dialog).getAllByRole('button'))
      expect(b.textContent?.trim()).toBeTruthy();
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

  it('treats Esc as "Don\'t send"', async () => {
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

  it('shows an error and stays open when the server refuses', async () => {
    const api = createMockApi();
    vi.spyOn(api, 'approve').mockRejectedValue(new Error('approval is for different arguments'));
    const dialog = await openFromTask(api);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Send as you/ }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
