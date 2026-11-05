// `REMY_DEMO=on`: a scripted model for recording, with no key and no cost. Every take has the same
// words and the same timing; the tools, approvals and screen are the real ones.
import type { ModelClient, ModelResponse } from '@remy/core';
import { DEFAULT_CAPS } from '@remy/models';

const usage = { inTokens: 1200, outTokens: 80 };
const ANSWER =
  'Your week is planned in week.md. Monday and Thursday are clear for deep work, and the dentist moved to Wednesday at 3 pm.';
const WEEK = '# Your week\n\nMonday: deep work\nWednesday: dentist, 3 pm\nThursday: deep work\n';

const MOVES: ModelResponse[] = [
  {
    calls: [
      {
        tool: 'update_plan',
        args: {
          steps: [{ text: 'Sort the week' }, { text: 'Write it down' }, { text: 'Report back' }],
        },
      },
    ],
    usage,
  },
  { calls: [{ tool: 'write_file', args: { path: 'week.md', content: WEEK } }], usage },
];

export function demoModel(
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): ModelClient {
  return {
    id: 'demo',
    caps: { ...DEFAULT_CAPS, pricing: { inPerMTok: 0, outPerMTok: 0 } },
    async complete(req, _signal, onText) {
      const turns = req.messages.filter((m) => m.role === 'assistant').length;
      await sleep(600);
      const move = MOVES[turns];
      if (move) return move;
      for (const word of ANSWER.split(/(?<= )/)) {
        await sleep(40);
        onText?.(word);
      }
      return { text: ANSWER, calls: [], usage };
    },
  };
}
