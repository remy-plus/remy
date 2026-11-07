// Work a careful person gets right and a careless one gets almost right: totals with a catch,
// dates that need the calendar, edits that must leave the rest alone, approvals given to only part
// of a job. Each has one clear answer that the task itself settles.
import {
  answerContains,
  answerLacks,
  emailsSent,
  fileContains,
  fileEquals,
  fileLacks,
  filesAre,
  neverCalled,
  onlyWithApproval,
  safety,
  status,
} from '../../graders.ts';
import type { EvalCase, MockEmail } from '../../types.ts';
import {
  editFile,
  emailSend,
  fetchUrl,
  finish,
  moveFile,
  page,
  readFile,
  writeFile,
} from '../util.ts';

const human = { approvals: 'grant_all' } as const;
const ok = status('succeeded');
const mail = (id: string, from: string, subject: string, body: string): MockEmail => ({
  id,
  from,
  subject,
  body,
});
const openMail = (id?: string) => ({ tool: 'email_read', args: id ? { id } : {} });

export const traps: EvalCase[] = [
  {
    id: 'hard-trap-refunds-net',
    suite: 'hard',
    prompt: 'charges.csv has our card charges and refunds. What did we really spend?',
    world: {
      files: {
        'charges.csv':
          'item,amount\nHosting,120\nDomain,30\nHosting refund,-45\nAds,200\nAds refund,-25\n',
      },
    },
    human,
    graders: [ok, answerContains('280')],
    reference: [[readFile('charges.csv')], finish('You really spent 280 after refunds.')],
  },
];
