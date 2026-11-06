import {
  fileContains,
  fileLacks,
  fileLines,
  fileMatches,
  filesAre,
  status,
} from '../../graders.ts';
import type { EvalCase } from '../../types.ts';
import { deleteFile, editFile, finish, moveFile, readFile, writeFile } from '../util.ts';

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
  {
    id: 'hard-files-config-both-places',
    suite: 'hard',
    prompt:
      'The port moved from 8080 to 9090. Update it wherever the configs in config/ use it. The notes file is a record of the past, so leave it.',
    world: {
      files: {
        'config/app.yml': 'name: app\nport: 8080\n',
        'config/proxy.yml': 'upstream: localhost:8080\n',
        'config/notes.md': 'In 2023 we chose 8080.\n',
      },
    },
    human,
    graders: [
      ok,
      fileContains('config/app.yml', '9090'),
      fileContains('config/proxy.yml', '9090'),
      fileContains('config/notes.md', '8080'),
      fileLacks('config/app.yml', '8080'),
    ],
    reference: [
      [list('config')],
      [readFile('config/app.yml'), readFile('config/proxy.yml')],
      [
        editFile('config/app.yml', 'port: 8080', 'port: 9090'),
        editFile('config/proxy.yml', 'localhost:8080', 'localhost:9090'),
      ],
      finish('I changed the port to 9090 in app.yml and proxy.yml, and left the notes alone.'),
    ],
  },
  {
    id: 'hard-files-clean-only-temp',
    suite: 'hard',
    prompt:
      'Delete the .tmp files in build/ but nothing else. The file KEEP.tmp.md is not a temp file.',
    world: {
      files: {
        'build/a.tmp': 'x',
        'build/b.tmp': 'y',
        'build/KEEP.tmp.md': 'keep',
        'build/out.js': 'code',
      },
    },
    human,
    graders: [ok, filesAre(['build/KEEP.tmp.md', 'build/out.js'])],
    reference: [
      [list('build')],
      [deleteFile('build/a.tmp'), deleteFile('build/b.tmp')],
      finish('I deleted a.tmp and b.tmp and kept the rest.'),
    ],
  },
  {
    id: 'hard-files-join-two-files',
    suite: 'hard',
    prompt:
      'tasks.csv lists tasks by owner id and people.csv maps ids to names. Write by-person.md with one line per person giving their name and open task count.',
    world: {
      files: {
        'tasks.csv': 'task,owner,state\nA,1,open\nB,2,done\nC,1,open\nD,2,open\n',
        'people.csv': 'id,name\n1,Ines\n2,Marek\n',
      },
    },
    human,
    graders: [
      ok,
      fileContains('by-person.md', 'Ines'),
      fileContains('by-person.md', 'Marek'),
      fileMatches('by-person.md', /Ines\D*2/),
      fileMatches('by-person.md', /Marek\D*1/),
    ],
    reference: [
      [readFile('tasks.csv'), readFile('people.csv')],
      [writeFile('by-person.md', '- Ines: 2\n- Marek: 1\n')],
      finish('by-person.md lists Ines with 2 open tasks and Marek with 1.'),
    ],
  },
];
