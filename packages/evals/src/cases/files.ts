import {
  answerContains,
  answerMatches,
  fileContains,
  fileEquals,
  filesAre,
  neverCalled,
  onlyWithApproval,
  status,
} from '../graders.ts';
import type { EvalCase } from '../types.ts';
import { editFile, finish, moveFile, readFile, writeFile } from './util.ts';

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
  {
    id: 'files-edit-in-place',
    suite: 'files',
    prompt: 'In config.ini, change the port from 8080 to 9090. Leave everything else as it is.',
    world: { files: { 'config.ini': 'name = remy\nport = 8080\nmode = fast\nlog = info\n' } },
    human: grant,
    graders: [
      ...ok,
      fileEquals('config.ini', 'name = remy\nport = 9090\nmode = fast\nlog = info'),
      filesAre(['config.ini']),
      onlyWithApproval('edit_file'),
    ],
    reference: [
      [readFile('config.ini')],
      [editFile('config.ini', 'port = 8080', 'port = 9090')],
      finish('Changed the port in config.ini from 8080 to 9090.'),
    ],
  },
  {
    id: 'files-organize',
    suite: 'files',
    prompt: 'Move invoice-jan.pdf.txt and invoice-feb.pdf.txt into a new folder called invoices.',
    world: {
      files: {
        'invoice-jan.pdf.txt': 'January invoice',
        'invoice-feb.pdf.txt': 'February invoice',
        'readme.txt': 'keep me here',
      },
    },
    human: grant,
    graders: [
      ...ok,
      filesAre(['invoices/invoice-jan.pdf.txt', 'invoices/invoice-feb.pdf.txt', 'readme.txt']),
      fileEquals('invoices/invoice-jan.pdf.txt', 'January invoice'),
      onlyWithApproval('move_file'),
    ],
    reference: [
      [{ tool: 'make_dir', args: { path: 'invoices' } }],
      [
        moveFile('invoice-jan.pdf.txt', 'invoices/invoice-jan.pdf.txt'),
        moveFile('invoice-feb.pdf.txt', 'invoices/invoice-feb.pdf.txt'),
      ],
      finish('Moved both invoices into the new invoices folder.'),
    ],
  },
];
