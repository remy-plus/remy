import { fileContains, status } from '../../graders.ts';
import type { EvalCase } from '../../types.ts';
import { finish, readFile, writeFile } from '../util.ts';

const human = { approvals: 'grant_all' } as const;
const _list = (path = '.') => ({ tool: 'list_files', args: { path } });
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
];
