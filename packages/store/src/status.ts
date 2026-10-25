import type { Event, TaskStatus } from '@remy/core';

/** Cached task status after `event`; unchanged for events that don't move it. */
export function nextStatus(current: TaskStatus, event: Event): TaskStatus {
  switch (event.type) {
    case 'approval.requested':
      return 'waiting_approval';
    case 'user.asked':
      return 'waiting_user';
    case 'approval.resolved':
    case 'user.answered':
      return 'running';
    case 'task.finished':
      return event.status;
    default:
      return current;
  }
}
