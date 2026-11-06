import { fileContains, fileLines, filesAre, status } from '../../graders.ts';
import type { EvalCase } from '../../types.ts';
import { finish, moveFile, readFile, writeFile } from '../util.ts';

const human = { approvals: 'grant_all' } as const;
const list = (path = '.') => ({ tool: 'list_files', args: { path } });
const ok = status('succeeded');

export const files: EvalCase[] = [
  {
    id: 'hard-files-sum-paid-only',
    suite: 'hard',
    prompt: 'From invoices.csv, add up only the paid invoices and write the total to total.txt.',
    world: {
      files: {
        'invoices.csv': 'id,amount,status\n1,100,paid\n2,250,open\n3,75,paid\n4,1000,void\n',
      },
    },
    human,
    graders: [ok, fileContains('total.txt', '175')],
    reference: [
      [readFile('invoices.csv')],
      [writeFile('total.txt', '175')],
      finish('The paid invoices total 175, saved in total.txt.'),
    ],
  },
  {
    id: 'hard-files-rename-by-date',
    suite: 'hard',
    prompt:
      'Rename the files in reports/ from MM-DD-YYYY.md to YYYY-MM-DD.md so they sort by date. Keep the contents.',
    world: {
      files: {
        'reports/03-14-2025.md': 'march',
        'reports/11-02-2024.md': 'november',
      },
    },
    human,
    graders: [
      ok,
      filesAre(['reports/2025-03-14.md', 'reports/2024-11-02.md']),
      fileContains('reports/2025-03-14.md', 'march'),
    ],
    reference: [
      [list('reports')],
      [
        moveFile('reports/03-14-2025.md', 'reports/2025-03-14.md'),
        moveFile('reports/11-02-2024.md', 'reports/2024-11-02.md'),
      ],
      finish('I renamed both reports to YYYY-MM-DD.md.'),
    ],
  },
  {
    id: 'hard-files-dedupe-contacts',
    suite: 'hard',
    prompt:
      'contacts.txt has one email per line. Remove duplicates, ignoring case, and keep the file sorted. Save it in place.',
    world: {
      files: { 'contacts.txt': 'zoe@a.test\nAMY@a.test\nbo@a.test\namy@A.test\nZoe@a.test\n' },
    },
    human,
    graders: [ok, fileContains('contacts.txt', 'bo@a.test'), fileLines('contacts.txt', 3)],
    reference: [
      [readFile('contacts.txt')],
      [writeFile('contacts.txt', 'amy@a.test\nbo@a.test\nzoe@a.test\n')],
      finish('contacts.txt now has three unique, sorted emails.'),
    ],
  },
];
