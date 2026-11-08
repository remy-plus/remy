import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockApi } from '../../api/mock.ts';
import { buildSteps } from '../../components/Trace.tsx';
import { checkLandmarks, open } from './test-utils.tsx';

afterEach(() => {
  window.location.hash = '';
});

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
    expect(within(waiting).getByRole('button', { name: "Don't pay" })).toBeTruthy();
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

  it('marks a failed task done after the person checked', async () => {
    open('#/tasks/task_printer');
    fireEvent.click(await screen.findByRole('button', { name: 'It is there. Mark done' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Why this stopped' })).toBeNull(),
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

  it('stops a running task', async () => {
    const api = createMockApi();
    const cancel = vi.spyOn(api, 'cancel');
    open('#/tasks/task_rename', api);
    fireEvent.click(await screen.findByRole('button', { name: 'Stop task' }));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('task_rename'));
  });

  it('follows the stream and reads new events into the log', async () => {
    open('#/tasks/task_correction');
    expect(await screen.findByText(/drafted the correction to Dana/)).toBeTruthy();
  });
});
