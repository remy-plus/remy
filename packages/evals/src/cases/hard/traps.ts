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
  {
    id: 'hard-trap-corrected-row',
    suite: 'hard',
    prompt:
      'orders.csv lists orders by id. A later row for the same id is a correction. What is the total?',
    world: { files: { 'orders.csv': 'id,amount\n1,50\n2,75\n3,20\n2,70\n4,10\n3,25\n' } },
    human,
    graders: [ok, answerContains('155')],
    reference: [
      [readFile('orders.csv')],
      finish('The total is 155 once corrections replace the first rows.'),
    ],
  },
  {
    id: 'hard-trap-one-currency',
    suite: 'hard',
    prompt: 'Add up only the EUR invoices in invoices.csv.',
    world: {
      files: {
        'invoices.csv': 'id,amount,currency\nA,100,EUR\nB,250,USD\nC,40,EUR\nD,60,GBP\nE,15,EUR\n',
      },
    },
    human,
    graders: [ok, answerContains('155')],
    reference: [[readFile('invoices.csv')], finish('The EUR invoices add up to 155.')],
  },
  {
    id: 'hard-trap-two-units',
    suite: 'hard',
    prompt:
      'shipment.txt lists parcel weights. Give the total in kilograms, rounded to one decimal. One pound is 0.4536 kg.',
    world: { files: { 'shipment.txt': '12 kg\n10 lb\n3 kg\n20 lb\n' } },
    human,
    graders: [ok, answerContains('28.6')],
    reference: [[readFile('shipment.txt')], finish('The total is 28.6 kg.')],
  },
  {
    id: 'hard-trap-top-three',
    suite: 'hard',
    prompt:
      'List the three biggest customers by revenue from sales.csv, biggest first, in top.txt, one name per line.',
    world: {
      files: {
        'sales.csv': 'name,revenue\nAcme,900\nBolt,10000\nCora,2500\nDune,3000\nEcho,850\n',
      },
    },
    human,
    graders: [ok, fileEquals('top.txt', 'Bolt\nDune\nCora')],
    reference: [
      [readFile('sales.csv')],
      [writeFile('top.txt', 'Bolt\nDune\nCora')],
      finish('top.txt lists Bolt, Dune and Cora.'),
    ],
  },
  {
    id: 'hard-trap-tomorrow-weekday',
    suite: 'hard',
    prompt: 'What day of the week is tomorrow?',
    world: {},
    human,
    graders: [ok, answerContains('Saturday')],
    reference: [finish('Tomorrow is Saturday.')],
  },
  {
    id: 'hard-trap-days-overdue',
    suite: 'hard',
    prompt: 'bills.csv has due dates. Which bill is overdue today, and by how many days?',
    world: {
      files: { 'bills.csv': 'bill,due\nWater,2026-11-20\nPower,2026-10-30\nRent,2026-12-01\n' },
    },
    human,
    graders: [ok, answerContains(['Power', '7'])],
    reference: [[readFile('bills.csv')], finish('Power is overdue by 7 days.')],
  },
  {
    id: 'hard-trap-due-this-week',
    suite: 'hard',
    prompt:
      'Which items in tasks.csv are due in the next seven days? Do not count anything already past.',
    world: {
      files: {
        'tasks.csv':
          'task,due\nTax form,2026-11-09\nOld report,2026-11-02\nBudget,2026-11-30\nReview,2026-11-13\n',
      },
    },
    human,
    graders: [ok, answerContains(['Tax form', 'Review']), answerLacks(/Old report|Budget/)],
    reference: [
      [readFile('tasks.csv')],
      finish('Tax form and Review are due in the next seven days.'),
    ],
  },
];
