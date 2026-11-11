import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../../api/mock.ts';
import type { RemyApi } from '../../api/types.ts';
import { buildSteps } from '../../components/Trace.tsx';
import { checkLandmarks, open } from './test-utils.tsx';

afterEach(() => {
  window.location.hash = '';
});

/** A failure the way the adapter sends one: a status, and no words of its own. */
const status = (code: number) => Object.assign(new Error(''), { status: code });

describe('Task view', () => {
  it('builds the trace from the task calls, with a hidden "done" on finished steps', async () => {
    const view = await createMockApi().getTask('task_printer');
    const steps = buildSteps(view, (iso) => iso.slice(11, 16));
    expect(steps.map((s) => [s.label, s.state])).toEqual([
      ['Read your request', 'done'],
      ['You approved sending to the tracker', 'done'],
      ['Create the issue in the tracker', 'failed'],
    ]);

    open('#/tasks/task_printer');
    const trace = await screen.findByRole('list', { name: /step by step/ });
    const items = [...trace.querySelectorAll(':scope > li')];
    expect(items).toHaveLength(3);
    expect(within(items[0] as HTMLElement).getByText(/\(done\)/).className).toContain('sr-only');
  });

  it('shows a waiting step with the approval card on the trace', async () => {
    open('#/tasks/task_flights');
    const trace = await screen.findByRole('list', { name: /step by step/ });
    const waiting = within(trace).getAllByRole('listitem')[1] as HTMLElement;
    expect(within(waiting).getByText(/waiting for your OK/)).toBeTruthy();
    expect(within(waiting).getByRole('button', { name: 'Review and pay' })).toBeTruthy();
    expect(within(waiting).getByRole('button', { name: 'Not now' })).toBeTruthy();
    expect(within(waiting).getByText('Nothing happens until you answer.')).toBeTruthy();
  });

  it('says what happened when a task failed, and does not retry by itself', async () => {
    open('#/tasks/task_printer');
    const why = await screen.findByRole('region', { name: 'Why this stopped' });
    expect(within(why).getByText(/The connection closed before the tracker answered/)).toBeTruthy();
    expect(within(why).getByText(/I did not send it again/)).toBeTruthy();
    for (const name of ['I checked. Try again', 'It is there. Mark done']) {
      expect(within(why).getByRole('button', { name })).toBeTruthy();
    }
    expect(within(why).getByRole('link', { name: 'Open the tracker' })).toBeTruthy();
    expect(
      screen.getByText(/Remy never repeats something that changes the outside world/),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull(); // nothing to add to a stopped task
    checkLandmarks();
  });

  it('says it worked when a failed task is marked done', async () => {
    open('#/tasks/task_printer');
    fireEvent.click(await screen.findByRole('button', { name: 'It is there. Mark done' }));
    expect(await screen.findByText('Marked as done. Remy will not try this again.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Why this stopped' })).toBeNull(),
    );
  });

  it('says why a retry did not start', async () => {
    const api = createMockApi();
    vi.spyOn(api, 'startTask').mockRejectedValue(status(429));
    open('#/tasks/task_printer', api);
    fireEvent.click(await screen.findByRole('button', { name: 'I checked. Try again' }));
    const why = screen.getByRole('region', { name: 'Why this stopped' });
    expect(await within(why).findByRole('alert')).toHaveProperty(
      'textContent',
      'Too many requests just now. Wait a moment, then try again.',
    );
  });

  it('says it worked when the person approves, and what was not done when they say not now', async () => {
    open('#/tasks/task_correction');
    fireEvent.click(await screen.findByRole('button', { name: 'Review and send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send this correction to Dana?' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Send as you/ }));
    expect(
      await screen.findByText('Approved. Remy sends this one message, then carries on.'),
    ).toBeTruthy();
  });

  it('says nothing was sent when the person says not now', async () => {
    open('#/tasks/task_correction');
    fireEvent.click(await screen.findByRole('button', { name: 'Review and send' }));
    const dialog = await screen.findByRole('dialog', { name: 'Send this correction to Dana?' });
    fireEvent.click(within(dialog).getByRole('button', { name: /^Not now/ }));
    expect(await screen.findByText('Not now. Nothing was sent.')).toBeTruthy();
  });

  it('says a stopped job did not finish, and offers a way to start it again', async () => {
    open('#/tasks/task_tidy');
    const stopped = await screen.findByRole('region', { name: "Didn't finish" });
    expect(within(stopped).getByText(/Stopped by you/)).toBeTruthy();
    expect(within(stopped).getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(within(stopped).getByRole('link', { name: 'See what Remy has done' })).toBeTruthy();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  it('offers a way forward when a job has no steps yet', async () => {
    open('#/tasks/task_rename');
    const empty = await screen.findByRole('region', { name: 'No steps yet' });
    expect(within(empty).getByText('Nothing has happened yet.')).toBeTruthy();
    fireEvent.click(within(empty).getByRole('button', { name: 'Add a note for Remy' }));
    await waitFor(() => expect(document.activeElement?.id).toBe('task-composer'));
  });

  it('names what it is opening instead of saying "Loading"', () => {
    const api: RemyApi = { ...createMockApi(), getTask: () => new Promise<never>(() => {}) };
    open('#/tasks/task_rename', api);
    expect(screen.getByText('Opening this job')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/^Loading$/);
  });

  it('says why a job could not be opened, and offers to try again', async () => {
    const api: RemyApi = { ...createMockApi(), getTask: () => Promise.reject(status(402)) };
    open('#/tasks/task_rename', api);
    expect(await screen.findByText(/This month's spending limit is reached/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See what Remy has done' })).toBeTruthy();
  });

  it('says when a refresh failed, rather than showing a stale screen', async () => {
    const api = createMockApi();
    const getTask = api.getTask.bind(api);
    let fail = false;
    vi.spyOn(api, 'getTask').mockImplementation((taskId) =>
      fail ? Promise.reject(status(500)) : getTask(taskId),
    );
    open('#/tasks/task_rename', api);
    await screen.findByRole('button', { name: 'Stop this job' });
    fail = true;
    fireEvent.click(screen.getByRole('button', { name: 'Stop this job' }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      "Remy's server hit a problem. Try again in a moment.",
    );
  });

  it('shows the answer with its sources and the contradiction', async () => {
    open('#/tasks/task_owe');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'What do I still owe Dana?' }),
    ).toBeTruthy();
    const sources = screen.getByRole('complementary', { name: 'Sources' });
    expect(within(sources).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Contradiction' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Ask a follow-up' })).toBeTruthy();
    checkLandmarks();
  });

  it('shows the helpers, the plan and the draft being made', async () => {
    open('#/tasks/task_audit');
    const helpers = await screen.findByRole('region', { name: 'Helpers' });
    expect(within(helpers).getAllByRole('heading', { level: 3 })).toHaveLength(4);
    expect(screen.getByRole('region', { name: 'Plan' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'What Remy is making' })).toBeTruthy();
    checkLandmarks();
  });

  it('stops a running job', async () => {
    const api = createMockApi();
    const cancel = vi.spyOn(api, 'cancel');
    open('#/tasks/task_rename', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop this job' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('task_rename'));
  });

  it('follows the stream and reads new events into the log', async () => {
    open('#/tasks/task_correction');
    expect(await screen.findByText(/drafted the correction to Dana/)).toBeTruthy();
  });

  it('never shows military time', async () => {
    open('#/tasks/task_printer');
    await screen.findByRole('region', { name: 'Why this stopped' });
    const text = document.body.textContent ?? '';
    expect(text).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    // Every time on the page is a 12-hour one: nothing is left as "09:13".
    expect(text.match(/\d{1,2}:\d{2}(?!\s?(AM|PM))/gi)).toBeNull();
  });
});
