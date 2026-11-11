import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../App.tsx';
import { a11yProblems } from '../a11y.testing.ts';
import { ApiProvider } from '../api/index.tsx';
import { createMockApi } from '../api/mock.ts';
import type { RemyApi } from '../api/types.ts';

const app = (api: RemyApi = createMockApi()) => {
  window.location.hash = '#/activity';
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};
const talk = () =>
  act(() => {
    window.dispatchEvent(new Event('remy:voice'));
  });

afterEach(() => {
  window.location.hash = '';
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'SpeechRecognition');
  Reflect.deleteProperty(window, 'webkitSpeechRecognition');
});

describe('PushToTalk without speech recognition', () => {
  it('says the browser cannot listen and offers a box instead', async () => {
    app();
    talk();
    const dialog = await screen.findByRole('dialog', { name: 'Push to talk' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText("This browser can't listen. Type instead.")).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'What you need done' })).toBeTruthy();
    expect(screen.queryByText('release to send', { exact: false })).toBeNull();
  });

  it('sends what was typed as a task', async () => {
    app();
    talk();
    const box = await screen.findByRole('textbox', { name: 'What you need done' });
    fireEvent.change(box, { target: { value: 'Move the Lisbon flight to Wednesday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/tasks\/task_mock/));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('closes on Esc and on Cancel, and sends nothing for an empty box', async () => {
    app();
    talk();
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    talk();
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.location.hash).toBe('#/activity');
    talk();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says why a job did not start', async () => {
    const api: RemyApi = {
      ...createMockApi(),
      startTask: () => Promise.reject(Object.assign(new Error(''), { status: 402 })),
    };
    app(api);
    talk();
    const box = await screen.findByRole('textbox', { name: 'What you need done' });
    fireEvent.change(box, { target: { value: 'Move the Lisbon flight to Wednesday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      "This month's spending limit is reached. Raise it in Settings, under Spending, or wait until next month.",
    );
    expect(screen.getByRole('dialog', { name: 'Push to talk' })).toBeTruthy();
  });

  it('has no basic accessibility problems', async () => {
    app();
    talk();
    await screen.findByRole('dialog', { name: 'Push to talk' });
    expect(a11yProblems()).toEqual([]);
  });
});

describe('PushToTalk with speech recognition', () => {
  interface Fake {
    onresult: ((e: unknown) => void) | null;
    started: boolean;
    aborted: boolean;
  }
  let made: Fake[] = [];
  beforeEach(() => {
    made = [];
    class FakeRecognition implements Fake {
      continuous = false;
      interimResults = false;
      lang = '';
      onresult: ((e: unknown) => void) | null = null;
      onerror = null;
      onend = null;
      started = false;
      aborted = false;
      constructor() {
        made.push(this);
      }
      start() {
        this.started = true;
      }
      stop() {}
      abort() {
        this.aborted = true;
      }
    }
    Object.assign(window, { webkitSpeechRecognition: FakeRecognition });
  });
  const hear = (done: string, partial = '') =>
    act(() => {
      const items = [{ isFinal: true, 0: { transcript: done } }];
      if (partial) items.push({ isFinal: false, 0: { transcript: partial } });
      made.at(-1)?.onresult?.({ resultIndex: 0, results: items });
    });

  it('listens, shows the words, and sends them with Send', async () => {
    app();
    talk();
    expect(await screen.findByText('Listening')).toBeTruthy();
    expect(made.at(-1)?.started).toBe(true);
    hear('Move the Lisbon flight to Wednesday', ' and tell Dana');
    expect(screen.getByText(/Move the Lisbon flight to Wednesday/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/tasks\/task_mock/));
    expect(made.at(-1)?.aborted).toBe(true);
  });

  it('turns the words into a box with Edit', async () => {
    app();
    talk();
    await screen.findByText('Listening');
    hear('Draft a reply');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = (await screen.findByRole('textbox', {
      name: 'What you need done',
    })) as HTMLTextAreaElement;
    expect(box.value).toBe('Draft a reply');
  });

  it('listens while Space is held and sends on release', async () => {
    vi.useFakeTimers();
    app();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    expect(screen.getByText('Listening')).toBeTruthy();
    hear('Find three flights to Lisbon');
    vi.useRealTimers();
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    await waitFor(() => expect(window.location.hash).toMatch(/^#\/tasks\/task_mock/));
  });

  it('ignores a quick tap of Space and Space in a text box', async () => {
    vi.useFakeTimers();
    app();
    fireEvent.keyDown(document.body, { key: ' ', code: 'Space' });
    fireEvent.keyUp(document.body, { key: ' ', code: 'Space' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    const field = document.createElement('input');
    document.body.append(field);
    fireEvent.keyDown(field, { key: ' ', code: 'Space' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    field.remove();
    expect(made).toHaveLength(0);
  });
});
