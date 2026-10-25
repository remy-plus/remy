import {
  type Message,
  type ModelClient,
  ModelError,
  type ModelRequest,
  type ModelResponse,
} from '@remy/core';

export const MAX_REPAIRS = 2;

export function addUsage(a: ModelResponse['usage'], b: ModelResponse['usage']) {
  return { inTokens: a.inTokens + b.inTokens, outTokens: a.outTokens + b.outTokens };
}

function findProblem(res: ModelResponse, known: Set<string>): string | undefined {
  for (const c of res.calls) {
    if (!known.has(c.tool))
      return `Unknown tool "${c.tool}". Available tools: ${[...known].join(', ')}.`;
    if (typeof c.args !== 'object' || c.args === null || Array.isArray(c.args))
      return `Arguments for tool "${c.tool}" are not a valid JSON object${
        typeof c.args === 'string' ? `: ${c.args.slice(0, 200)}` : ''
      }.`;
  }
  return undefined;
}

/** Native tool calling, with up to two repair retries on bad calls. */
export function withNativeTools(raw: ModelClient): ModelClient {
  return {
    id: raw.id,
    caps: raw.caps,
    async complete(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
      const known = new Set(req.tools.map((t) => t.name));
      const messages: Message[] = [...req.messages];
      let usage = { inTokens: 0, outTokens: 0 };
      for (let attempt = 0; ; attempt++) {
        const res = await raw.complete({ ...req, messages }, signal);
        usage = addUsage(usage, res.usage);
        const problem = findProblem(res, known);
        if (!problem) return { ...res, usage };
        if (attempt >= MAX_REPAIRS)
          throw new ModelError(
            `tool call still invalid after ${MAX_REPAIRS} retries: ${problem}`,
            false,
          );
        messages.push(
          { role: 'assistant', content: res.text ?? JSON.stringify(res.calls) },
          {
            role: 'user',
            content: `Your tool call was rejected: ${problem} Call a valid tool again.`,
          },
        );
      }
    },
  };
}
