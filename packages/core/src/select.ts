// Per-step tool selection. Built-ins are always offered; "selectable" tools (MCP) are offered in
// full while there are few of them, and otherwise as the best matches for the task plus anything
// find_tools returned. Pure and deterministic, so a resumed task offers what it offered before.
import { z } from 'zod';
import { defineTool, type ToolRegistry } from './registry.ts';
import type { TaskState } from './state.ts';
import { FIND_TOOLS, type Tool } from './types.ts';

/** Selectable tools above this count are filtered; at or below it everything is offered. */
export const SELECT_THRESHOLD = 12;
/** How many selectable tools a step offers from scoring. */
export const SELECT_TOP = 12;
/** Most tools one `find_tools` call returns. */
export const FIND_TOOLS_LIMIT = 8;
/** Most discovered tools kept on offer (newest win) so a long task cannot grow the tool list. */
const MAX_DISCOVERED = 12;

const STOP = new Set(
  'a an the and or of to for in on at by with from into is are be it this that my me you your please can could would should do does did all any some new via as'.split(
    ' ',
  ),
);

/** Words from a name or text: splits snake_case, camelCase, digits and `server__tool` prefixes; light plural stemming. */
export function tokenize(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map(stem);
}

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

export interface Doc {
  name: string;
  text: string;
}

const K1 = 1.2;
const B = 0.75;
/** A match in the tool's name counts this many times a match in its description. */
const NAME_WEIGHT = 3;

/** BM25 scores for `query` over the docs (name weighted above description). Missing or zero means no shared word. */
export function bm25(docs: Doc[], query: string): Map<string, number> {
  const q = [...new Set(tokenize(query))];
  const scores = new Map<string, number>();
  if (!q.length || !docs.length) return scores;
  const tfs = docs.map((d) => {
    const tf = new Map<string, number>();
    for (const w of tokenize(d.name)) tf.set(w, (tf.get(w) ?? 0) + NAME_WEIGHT);
    for (const w of tokenize(d.text)) tf.set(w, (tf.get(w) ?? 0) + 1);
    return { name: d.name, tf, len: [...tf.values()].reduce((a, b) => a + b, 0) };
  });
  const avg = tfs.reduce((n, d) => n + d.len, 0) / tfs.length || 1;
  const df = new Map<string, number>();
  for (const d of tfs) for (const w of q) if (d.tf.has(w)) df.set(w, (df.get(w) ?? 0) + 1);
  for (const d of tfs) {
    let score = 0;
    for (const w of q) {
      const f = d.tf.get(w);
      if (!f) continue;
      const n = df.get(w) ?? 0;
      const idf = Math.log(1 + (tfs.length - n + 0.5) / (n + 0.5));
      score += (idf * f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avg));
    }
    scores.set(d.name, score);
  }
  return scores;
}

/** Best matches first (score above zero only); ties by name, so order never depends on registry order. */
export function rank(docs: Doc[], query: string, limit: number): string[] {
  const scores = bm25(docs, query);
  return docs
    .map((d) => d.name)
    .filter((n) => (scores.get(n) ?? 0) > 0)
    .sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0) || (a < b ? -1 : 1))
    .slice(0, limit);
}

const docOf = (t: Tool): Doc => ({ name: t.name, text: t.description });
const selectableTools = (tools: ToolRegistry) => tools.list().filter((t) => t.selectable);

/** Added to the system prompt when a step is offered a subset of the connected tools. */
export const FIND_TOOLS_HINT =
  'Only some of the connected tools are listed. If none of them fits the task, call find_tools with a few words about what you want to do; the tools it finds become available on your next step.';

/** True when selection is active: more selectable tools than the threshold. */
export const needsSelection = (tools: ToolRegistry): boolean =>
  selectableTools(tools).length > SELECT_THRESHOLD;

/** What the model is working on: the prompt, recent user turns, its latest text and its latest plan. */
export function selectionQuery(s: TaskState): string {
  const parts = [s.prompt];
  const users = s.log.flatMap((e) => (e.kind === 'user' ? [e.text] : []));
  parts.push(...users.slice(-3));
  const lastModel = [...s.log].reverse().find((e) => e.kind === 'model');
  if (lastModel?.kind === 'model' && lastModel.text) parts.push(lastModel.text);
  const plan = Object.values(s.calls)
    .filter((c) => c.tool === 'update_plan')
    .at(-1)?.args as { steps?: { text?: unknown }[] } | undefined;
  for (const step of plan?.steps ?? []) if (typeof step?.text === 'string') parts.push(step.text);
  return parts.join('\n');
}

/**
 * Names of the tools to offer this step, from `candidates` (already filtered by permissions).
 * Always-on tools all stay. Selectable ones: all of them under the threshold; otherwise the top
 * `SELECT_TOP` by BM25 against the task, plus tools the task already called or found with find_tools.
 */
export function selectToolNames(tools: ToolRegistry, s: TaskState, candidates: string[]): string[] {
  if (!needsSelection(tools)) return candidates;
  const sel = new Set(selectableTools(tools).map((t) => t.name));
  const keep = new Set<string>(s.discovered.slice(-MAX_DISCOVERED));
  for (const c of Object.values(s.calls)) keep.add(c.tool);
  const docs = candidates.filter((n) => sel.has(n)).map((n) => docOf(tools.get(n) as Tool));
  for (const n of rank(docs, selectionQuery(s), SELECT_TOP)) keep.add(n);
  return candidates.filter((n) => !sel.has(n) || keep.has(n));
}

/** The `find_tools` tool for a registry. Only lists our own registry, so its output is trusted. */
export function createFindTools(tools: ToolRegistry): Tool {
  return defineTool({
    name: FIND_TOOLS,
    description:
      'Search the connected tools (from connected apps such as GitHub, Slack, Notion, calendars) by what you want to do. Returns matching tool names with a short description; the tools become available on your next step.',
    args: z.object({ query: z.string().min(1).describe('What you want to do, in a few words') }),
    risk: 'read',
    effect: 'none',
    outputTrust: 'trusted',
    timeoutMs: 5_000,
    maxOutputChars: 4_000,
    preview: ({ query }) => `Search tools: ${query}`,
    async execute({ query }, ctx) {
      // Tools the task may not call are not listed: their names and descriptions stay hidden.
      const visible = selectableTools(tools).filter((t) => ctx.permits?.(t.name) ?? true);
      const names = rank(visible.map(docOf), query, FIND_TOOLS_LIMIT);
      if (!names.length)
        return {
          ok: true,
          content: 'No connected tool matches that. Try different words.',
          trust: 'trusted',
          data: { names: [] },
        };
      const line = (n: string) => {
        const d = (tools.get(n)?.description ?? '').split(/(?<=[.!?])\s|\n/)[0] ?? '';
        return `${n}: ${d.length > 120 ? `${d.slice(0, 117)}...` : d}`;
      };
      return {
        ok: true,
        content: `${names.map(line).join('\n')}\nThese tools are now available.`,
        trust: 'trusted',
        data: { names },
      };
    },
  });
}
