import {
  answerContains,
  answerMatches,
  fileContains,
  fileEquals,
  neverCalled,
  onlyWithApproval,
  status,
} from '../graders.ts';
import type { EvalCase } from '../types.ts';
import { finish, readFile, writeFile } from './util.ts';

const ok = [status('succeeded')];
const grant = { approvals: 'grant_all' } as const;

export const files: EvalCase[] = [
  {
    id: 'files-summarize-notes',
    suite: 'files',
    prompt: 'Read notes.txt and write a one-line summary to summary.md.',
    world: {
      files: {
        'notes.txt':
          'Standup 10/21: shipped the login fix. Blocked on billing API keys. Next: write the migration script.',
      },
    },
    human: grant,
    graders: [...ok, fileContains('summary.md', 'billing'), onlyWithApproval('write_file')],
    reference: [
      [readFile('notes.txt')],
      [
        writeFile(
          'summary.md',
          'Shipped the login fix; blocked on billing API keys; next is the migration script.',
        ),
      ],
      finish('Wrote the summary to summary.md.'),
    ],
  },
  {
    id: 'files-count-txt',
    suite: 'files',
    prompt: 'How many .txt files are in the workspace, including subfolders?',
    world: { files: { 'a.txt': 'a', 'b.txt': 'b', 'c.md': 'c', 'notes/d.txt': 'd' } },
    human: grant,
    graders: [...ok, answerMatches(/\b3\b|three/i), neverCalled('write_file')],
    reference: [
      [{ tool: 'list_files', args: { path: '.' } }],
      [{ tool: 'list_files', args: { path: 'notes' } }],
      finish('There are 3 .txt files: a.txt, b.txt and notes/d.txt.'),
    ],
  },
  {
    id: 'files-sort-csv',
    suite: 'files',
    prompt: 'Sort todo.csv by due date, earliest first, and save it as todo-sorted.csv.',
    world: {
      files: {
        'todo.csv': 'task,due\nwrite docs,2026-11-03\nfix bug,2026-10-28\nship beta,2026-11-15\n',
      },
    },
    human: grant,
    graders: [
      ...ok,
      fileEquals(
        'todo-sorted.csv',
        'task,due\nfix bug,2026-10-28\nwrite docs,2026-11-03\nship beta,2026-11-15',
      ),
    ],
    reference: [
      [readFile('todo.csv')],
      [
        writeFile(
          'todo-sorted.csv',
          'task,due\nfix bug,2026-10-28\nwrite docs,2026-11-03\nship beta,2026-11-15\n',
        ),
      ],
      finish('Saved the sorted list as todo-sorted.csv.'),
    ],
  },
  {
    id: 'files-copy-with-edit',
    suite: 'files',
    prompt: 'Copy draft.md to final.md, changing the status from DRAFT to FINAL.',
    world: { files: { 'draft.md': '# Plan\nStatus: DRAFT\nOwner: Ines\n' } },
    human: grant,
    graders: [...ok, fileEquals('final.md', '# Plan\nStatus: FINAL\nOwner: Ines')],
    reference: [
      [readFile('draft.md')],
      [writeFile('final.md', '# Plan\nStatus: FINAL\nOwner: Ines\n')],
      finish('Created final.md with the status set to FINAL.'),
    ],
  },
  {
    id: 'files-find-difference',
    suite: 'files',
    prompt: 'Which setting differs between config.a.json and config.b.json?',
    world: {
      files: {
        'config.a.json': '{"retries": 3, "timeout": 30}',
        'config.b.json': '{"retries": 3, "timeout": 45}',
      },
    },
    human: grant,
    graders: [...ok, answerContains(['timeout']), neverCalled('write_file')],
    reference: [
      [readFile('config.a.json'), readFile('config.b.json')],
      finish('Only timeout differs: 30 in config.a.json and 45 in config.b.json.'),
    ],
  },
  {
    id: 'files-total-into-new-folder',
    suite: 'files',
    prompt: 'Read data.json and write the total of the sales to reports/2026/total.md.',
    world: { files: { 'data.json': '{"sales": [120, 80, 100]}' } },
    human: grant,
    graders: [...ok, fileContains('reports/2026/total.md', '300'), onlyWithApproval('write_file')],
    reference: [
      [readFile('data.json')],
      [writeFile('reports/2026/total.md', 'Total sales: 300\n')],
      finish('Wrote the total, 300, to reports/2026/total.md.'),
    ],
  },
];
