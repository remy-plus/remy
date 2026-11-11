import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Confirm } from './Confirm.tsx';

/** A failure the way the adapter sends one: a status, and no words of its own. */
const status = (code: number) => Object.assign(new Error(''), { status: code });

const show = (onConfirm: () => unknown) => {
  const onCancel = vi.fn();
  render(
    <Confirm
      open
      title="Delete this chat?"
      confirmLabel="Delete"
      cancelLabel="Keep"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      The jobs Remy did in it stay in Activity.
    </Confirm>,
  );
  return { onCancel };
};

describe('Confirm', () => {
  it('says it is working while the answer is on its way', async () => {
    show(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Working');
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', true);
  });

  it('says why it did not go through, and stays open', async () => {
    show(() => Promise.reject(status(403)));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      "Remy is not allowed to do that. Check the app's permissions in Connections.",
    );
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks once, and leaves the closing to the caller', async () => {
    const onConfirm = vi.fn();
    show(onConfirm);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
