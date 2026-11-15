import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import type { RemyApi } from '../../api/types.ts';
import { Files } from './Files.tsx';

const clicks: { href: string; download: string }[] = [];
beforeEach(() => {
  clicks.length = 0;
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push({ href: this.href, download: this.download });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const show = (api: RemyApi) =>
  render(
    <ApiProvider api={api}>
      <Files taskId="task_x" />
    </ApiProvider>,
  );

const withFiles = (over: Partial<RemyApi> = {}): RemyApi => ({
  ...createMockApi(),
  taskFiles: async () => [{ path: 'groceries.txt', name: 'groceries.txt', size: 16 }],
  downloadTaskFile: async (_id, path) => ({ blob: new Blob(['milk']), name: path }),
  ...over,
});

describe('Files', () => {
  it('shows each file with its size, and saves it with its own name on click', async () => {
    show(withFiles());
    const chip = await screen.findByRole('button', { name: 'Download groceries.txt, 16 B' });
    expect(chip.textContent).toContain('groceries.txt');
    expect(chip.textContent).toContain('16 B');
    fireEvent.click(chip);
    await waitFor(() => expect(clicks).toEqual([{ href: 'blob:fake', download: 'groceries.txt' }]));
  });

  it('shows nothing when the task made no file, or the list cannot be read', async () => {
    const { container } = show(withFiles({ taskFiles: async () => [] }));
    await waitFor(() => expect(container.textContent).toBe(''));
    cleanup();
    const second = show(
      withFiles({
        taskFiles: async () => {
          throw new Error('no');
        },
      }),
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(second.container.textContent).toBe('');
  });

  it('says why when a file cannot be fetched, and lets the person try again', async () => {
    let fail = true;
    show(
      withFiles({
        downloadTaskFile: async (_id, path) => {
          if (fail) throw new Error('That file is gone now.');
          return { blob: new Blob(['x']), name: path };
        },
      }),
    );
    const chip = await screen.findByRole('button', { name: /Download groceries.txt/ });
    fireEvent.click(chip);
    expect((await screen.findByRole('alert')).textContent).toContain('That file is gone now.');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: /Download groceries.txt/ }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
