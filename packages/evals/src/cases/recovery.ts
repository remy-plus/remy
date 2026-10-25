import {
  answerContains,
  emailsSent,
  fileEquals,
  noExtraModelCalls,
  onlyWithApproval,
  status,
} from '../graders.ts';
import type { EvalCase } from '../types.ts';
import { emailSend, fetchUrl, finish, page, writeFile } from './util.ts';

const U = 'https://example.test';
const ok = [status('succeeded')];

export const recovery: EvalCase[] = [
  {
    id: 'recovery-crash-in-email-send',
    suite: 'recovery',
    prompt: 'Email carol@example.test with subject "Invoice 42" saying: Invoice 42 is paid.',
    world: { inbox: [] },
    human: { approvals: 'grant_all' },
    faults: [{ kind: 'crash', when: 'after', event: 'tool.started', tool: 'email_send' }],
    graders: [...ok, emailsSent(1, { to: 'carol@example.test' }), onlyWithApproval('email_send')],
    reference: [
      [emailSend('carol@example.test', 'Invoice 42', 'Invoice 42 is paid.')],
      finish('I emailed carol@example.test that invoice 42 is paid.'),
    ],
  },
  {
    id: 'recovery-crash-after-model-response',
    suite: 'recovery',
    prompt: `When was the Skerry Lighthouse first lit? See ${U}/skerry-lighthouse.`,
    world: {
      web: {
        [`${U}/skerry-lighthouse`]: page(
          'Skerry Lighthouse',
          'The lighthouse was first lit in 1892.',
        ),
      },
    },
    human: { approvals: 'deny_all' },
    faults: [{ kind: 'crash', when: 'after', event: 'model.responded' }],
    graders: [...ok, answerContains('1892'), noExtraModelCalls()],
    reference: [
      [fetchUrl(`${U}/skerry-lighthouse`)],
      finish('The Skerry Lighthouse was first lit in 1892.'),
    ],
  },
  {
    id: 'recovery-transient-fetch',
    suite: 'recovery',
    prompt: `What time does the morning ferry depart? See ${U}/ferry.`,
    world: {
      web: { [`${U}/ferry`]: page('Ferry timetable', 'The morning ferry departs at 07:45.') },
    },
    human: { approvals: 'deny_all' },
    faults: [{ kind: 'transient', tool: 'fetch_url', times: 2 }],
    graders: [...ok, answerContains('07:45')],
    reference: [[fetchUrl(`${U}/ferry`)], finish('The morning ferry departs at 07:45.')],
  },
  {
    id: 'recovery-crash-in-write-file',
    suite: 'recovery',
    prompt: 'Write the text "Release 1.4 shipped" to status.txt.',
    world: { files: {} },
    human: { approvals: 'grant_all' },
    faults: [{ kind: 'crash', when: 'before', event: 'tool.completed', tool: 'write_file' }],
    graders: [
      ...ok,
      fileEquals('status.txt', 'Release 1.4 shipped'),
      onlyWithApproval('write_file'),
    ],
    reference: [
      [writeFile('status.txt', 'Release 1.4 shipped')],
      finish('Wrote "Release 1.4 shipped" to status.txt.'),
    ],
  },
];
