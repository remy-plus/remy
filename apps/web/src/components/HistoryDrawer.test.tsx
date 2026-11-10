import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/index.tsx';
import { createMockApi } from '../api/mock.ts';
import type { ChatSummary, RemyApi } from '../api/types.ts';
import { HistoryDrawer } from './HistoryDrawer.tsx';

const at = (days: number, hours = 0) =>
  new Date(Date.now() - days * 86_400_000 - hours * 3_600_000).toISOString();

const seed = (): ChatSummary[] => [
  { id: 'a', title: 'Plan my week', updatedAt: at(0, 0.5), preview: '', state: 'working' },
  { id: 'b', title: 'Lisbon flights', updatedAt: at(1), preview: '', state: 'resting' },
  { id: 'c', title: 'Tax questions', updatedAt: at(3), preview: '', state: 'resting' },
  { id: 'd', title: 'Old idea', updatedAt: at(30), preview: '', state: 'resting' },
];

function setup(chats: ChatSummary[] = seed(), onClose = vi.fn()) {
  const list = [...chats];
  const api: RemyApi = {
    ...createMockApi(),
    listChats: vi.fn(async () => [...list]),
    renameChat: vi.fn(async (id: string, title: string) => {
      const c = list.find((x) => x.id === id);
      if (c) c.title = title;
    }),
    deleteChat: vi.fn(async (id: string) => {
      list.splice(
        list.findIndex((x) => x.id === id),
        1,
      );
    }),
  };
  render(
    <ApiProvider api={api}>
      <HistoryDrawer open onClose={onClose} />
    </ApiProvider>,
  );
  return { api, onClose };
}

afterEach(() => {
  window.location.hash = '';
});

describe('HistoryDrawer', () => {
  it('groups chats by when they were last used', async () => {
    setup();
    for (const [title, chat] of [
      ['Today', 'Plan my week'],
      ['Yesterday', 'Lisbon flights'],
      ['This week', 'Tax questions'],
      ['Earlier', 'Old idea'],
    ] as const) {
      const g = await screen.findByRole('region', { name: title });
      expect(within(g).getByText(chat)).toBeTruthy();
    }
  });

  it('shows no ids and opens a chat from its row', async () => {
    const { onClose } = setup();
    const link = await screen.findByRole('link', { name: /Lisbon flights/ });
    expect(link.getAttribute('href')).toBe('#/chat/b');
    expect(link.textContent).toBe('Lisbon flightsyesterday');
    fireEvent.click(link);
    expect(onClose).toHaveBeenCalled();
  });

  it('says so in plain words when there are no chats', async () => {
    setup([]);
    expect(await screen.findByText(/No chats yet/)).toBeTruthy();
  });

  it('starts a new chat', async () => {
    const { onClose } = setup();
    window.location.hash = '#/chat/b';
    fireEvent.click(await screen.findByRole('button', { name: 'New chat' }));
    expect(window.location.hash).toBe('#/');
    expect(onClose).toHaveBeenCalled();
  });

  it('renames a chat inline', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Lisbon flights' }));
    const box = screen.getByRole('textbox', { name: 'Chat name' });
    fireEvent.change(box, { target: { value: 'Lisbon in March' } });
    fireEvent.submit(box);
    await waitFor(() => expect(api.renameChat).toHaveBeenCalledWith('b', 'Lisbon in March'));
    expect(await screen.findByText('Lisbon in March')).toBeTruthy();
  });

  it('leaves the name alone when rename is cancelled with Escape', async () => {
    const { api, onClose } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Rename Lisbon flights' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Chat name' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(api.renameChat).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before deleting, and Keep leaves the chat', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Old idea' }));
    const ask = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep' }));
    expect(api.deleteChat).not.toHaveBeenCalled();
    expect(screen.getByText('Old idea')).toBeTruthy();
  });

  it('deletes after Delete is chosen', async () => {
    const { api } = setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Old idea' }));
    const ask = await screen.findByRole('dialog', { name: 'Delete this chat?' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.deleteChat).toHaveBeenCalledWith('d'));
    await waitFor(() => expect(screen.queryByText('Old idea')).toBeNull());
  });

  it('closes on Escape', async () => {
    const { onClose } = setup();
    fireEvent.keyDown(await screen.findByRole('dialog', { name: 'History' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
