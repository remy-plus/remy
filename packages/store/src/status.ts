import type { Event, TaskStatus } from '@remy/core';

/** Cached task status after `event`; unchanged for events that don't move it. */
export function nextStatus(current: TaskStatus, event: Event): TaskStatus {
  switch (event.type) {
    case 'approval.requested':
      return event.parked === undefined ? 'waiting_approval' : current;
    case 'approvals.held':
      return 'waiting_approval';
    case 'user.asked':
      return 'waiting_user';
    case 'budget.exhausted':
      return 'paused';
    case 'approval.resolved':
      // A parked card can be answered in any state; the task resumes when none is left.
      if (event.left !== undefined)
        return current === 'waiting_approval' && event.left === 0 ? 'running' : current;
      return 'running';
    case 'user.answered':
    case 'budget.extended':
      return 'running';
    case 'task.finished':
      return event.status;
    default:
      return current;
  }
}
