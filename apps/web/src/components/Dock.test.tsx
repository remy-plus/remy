import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../api/index.tsx';
import { createMockApi } from '../api/mock.ts';
import type { ChatSummary, RemyApi } from '../api/types.ts';
import { Dock, dockItems, mindOf } from './Dock.tsx';

const chat = (state: ChatSummary['state']): ChatSummary => ({
  id: `c_${state}`,
  title: 'A chat',
  updatedAt: new Date().toISOString(),
  preview: '',
  state,
});

const show = (path = '/', api: RemyApi = createMockApi()) =>
  render(
    <ApiProvider api={api}>
      <Dock path={path} />
    </ApiProvider>,
  );

const phone = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: on && q.includes('640'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));

const PLACES = ['Chat', 'Activity', 'Browser', 'Brain', 'Connections', 'Settings'];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dockItems', () => {
  it('keeps the saved order, drops unknown and repeated ids', () => {
    expect(dockItems(['settings', 'brain', 'nope', 'chat', 'brain']).map((i) => i.id)).toEqual([
      'settings',
      'brain',
      'chat',
    ]);
  });
  it('never loses Chat or Settings', () => {
    expect(dockItems(['brain']).map((i) => i.id)).toEqual(['chat', 'brain', 'settings']);
    expect(dockItems([]).map((i) => i.id)).toEqual(['chat', 'settings']);
  });
});

describe('mindOf', () => {
  it('prefers working, then waiting, else rest', () => {
    expect(mindOf([chat('resting'), chat('waiting'), chat('working')])).toBe('working');
    expect(mindOf([chat('resting'), chat('waiting')])).toBe('waiting');
    expect(mindOf([chat('resting')])).toBe('rest');
    expect(mindOf([])).toBe('rest');
  });
});

describe('Dock', () => {
  it('lists the six places, marks the current one, and has History and New chat', () => {
    show('/activity');
    const nav = screen.getByRole('navigation', { name: 'Main' });
    const names = within(nav)
      .getAllByRole('link')
      .map((a) => a.getAttribute('aria-label') ?? a.textContent);
    expect(names).toEqual([...PLACES, 'New chat']);
    expect(screen.getByRole('link', { name: 'Activity' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Chat' }).getAttribute('aria-current')).toBeNull();
    expect(screen.getByRole('button', { name: 'History' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'New chat' }).getAttribute('href')).toBe('#/');
  });

  it('shows Chat as current on a chat page', () => {
    show('/chat/abc');
    expect(screen.getByRole('link', { name: 'Chat' }).getAttribute('aria-current')).toBe('page');
  });

  it('follows the saved dock order and always keeps Chat and Settings', () => {
    window.localStorage.setItem('remy.dock', JSON.stringify(['brain', 'activity']));
    show();
    const labels = within(screen.getByRole('navigation', { name: 'Main' }))
      .getAllByRole('link')
      .map((a) => a.textContent)
      .filter((x) => x && x !== '+');
    expect(labels).toEqual(['Chat', 'Brain', 'Activity', 'Settings']);
  });

  it('ignores a broken dock setting', () => {
    window.localStorage.setItem('remy.dock', '"nope"');
    show();
    expect(screen.getByRole('link', { name: 'Browser' })).toBeTruthy();
  });

  it('shows the Mind as working when a chat is working', async () => {
    const api = createMockApi();
    api.listChats = async () => [chat('working')];
    show('/', api);
    expect(await screen.findByRole('img', { name: 'Remy is working' })).toBeTruthy();
  });

  it('opens the History drawer', async () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('dialog', { name: 'History' })).toBeTruthy();
  });

  it('is a compact bar on phones, with a menu sheet', async () => {
    phone(true);
    show('/brain');
    expect(screen.queryByRole('link', { name: 'Browser' })).toBeNull();
    expect(screen.getByText('Brain')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const sheet = await screen.findByRole('dialog', { name: 'Menu' });
    const links = within(sheet)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(links).toEqual([...PLACES, 'New chat']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'History' }));
    expect(await screen.findByRole('dialog', { name: 'History' })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
  });

  it('closes the menu sheet on Escape', async () => {
    phone(true);
    show('/');
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    const sheet = await screen.findByRole('dialog', { name: 'Menu' });
    act(() => {
      fireEvent.keyDown(sheet, { key: 'Escape' });
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull());
  });
});
