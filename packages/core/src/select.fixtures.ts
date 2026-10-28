// Test fixtures: a registry of built-ins plus 60 fake connected tools. Not exported from the package.
import { z } from 'zod';
import { defineTool } from './registry.ts';
import { fold, type TaskState } from './state.ts';
import { DEFAULT_BUDGET, type Event } from './types.ts';

export const fake = (name: string, description: string, selectable = true) =>
  defineTool({
    name,
    description,
    args: z.object({}),
    selectable,
    risk: 'read',
    effect: 'none',
    outputTrust: 'trusted',
    timeoutMs: 1000,
    maxOutputChars: 1000,
    preview: () => name,
    execute: async () => ({ ok: true, content: '', trust: 'trusted' }),
  });

const SERVICES: Record<string, [string, string][]> = {
  github: [
    ['create_issue', 'Create a new issue in a repository'],
    ['list_issues', 'List issues in a repository'],
    ['update_issue', 'Update an existing issue'],
    ['create_pull_request', 'Open a pull request'],
    ['list_pull_requests', 'List pull requests'],
    ['merge_pull_request', 'Merge a pull request'],
    ['search_code', 'Search code across repositories'],
    ['get_file_contents', 'Get the contents of a file'],
    ['list_commits', 'List commits on a branch'],
    ['create_branch', 'Create a branch'],
  ],
  slack: [
    ['post_message', 'Send a message to a channel'],
    ['list_channels', 'List channels in the workspace'],
    ['reply_to_thread', 'Reply to a message thread'],
    ['add_reaction', 'Add an emoji reaction to a message'],
    ['get_channel_history', 'Get recent messages from a channel'],
    ['list_users', 'List users in the workspace'],
    ['get_user_profile', 'Get a user profile'],
    ['search_messages', 'Search messages'],
    ['set_status', 'Set your status'],
    ['upload_file', 'Upload a file to a channel'],
  ],
  calendar: [
    ['list_events', 'List events on a calendar between two dates'],
    ['create_event', 'Create a calendar event'],
    ['update_event', 'Update a calendar event'],
    ['delete_event', 'Delete a calendar event'],
    ['find_free_time', 'Find free time slots'],
    ['list_calendars', 'List calendars'],
    ['get_event', 'Get one event'],
    ['respond_to_invite', 'Accept or decline an invitation'],
    ['quick_add_event', 'Add an event from a sentence'],
    ['list_reminders', 'List reminders'],
  ],
  notion: [
    ['search_pages', 'Search pages'],
    ['create_page', 'Create a page'],
    ['update_page', 'Update a page'],
    ['query_database', 'Query a database'],
    ['append_blocks', 'Append blocks to a page'],
    ['get_page', 'Get a page'],
    ['list_users', 'List workspace users'],
    ['create_comment', 'Comment on a page'],
    ['archive_page', 'Archive a page'],
    ['get_database', 'Get a database schema'],
  ],
  linear: [
    ['create_ticket', 'Create a ticket'],
    ['list_tickets', 'List tickets'],
    ['update_ticket', 'Update a ticket'],
    ['list_projects', 'List projects'],
    ['list_cycles', 'List cycles'],
    ['add_comment', 'Add a comment to a ticket'],
  ],
  drive: [
    ['list_files', 'List files'],
    ['read_document', 'Read a document'],
    ['create_folder', 'Create a folder'],
    ['share_file', 'Share a file'],
  ],
};

export const sixtyTools = () =>
  Object.entries(SERVICES).flatMap(([server, tools]) =>
    tools.map(([t, d]) => fake(`${server}__${t}`, `${d} (via ${server})`)),
  );

export const builtins = () => [
  fake('read_file', 'Read a file from the workspace', false),
  fake('finish', 'Finish the task', false),
  fake('ask_user', 'Ask the user a question', false),
];

export const stateFor = (prompt: string, ...events: Event[]): TaskState =>
  fold(
    [
      {
        type: 'task.created',
        prompt,
        config: {
          model: 'm',
          permissions: { autoApprove: ['read'] },
          budget: DEFAULT_BUDGET,
          workspaceDir: '/w',
        },
      } as Event,
      ...events,
    ].map((event, i) => ({
      taskId: 't',
      seq: i + 1,
      at: '2026-10-28T00:00:00.000Z',
      event,
    })),
  );
