// Plain-text rendering: colors, one-line event summaries, the readable timeline.
import type { StoredEvent, TaskState } from '@remy/core';
import { ansi, type ColorLevel } from './theme.ts';

export interface Styler {
  dim: (s: string) => string;
  accent: (s: string) => string;
  bold: (s: string) => string;
}

/** `true` means full color; pass a level from `detectColor` to honor NO_COLOR and 16-color terminals. */
export function styler(level: boolean | ColorLevel): Styler {
  const l: ColorLevel = level === true ? 'truecolor' : level === false ? 'none' : level;
  const wrap = (role: Parameters<typeof ansi>[1]) => (s: string) =>
    l === 'none' ? s : `${ansi(l, role)}${s}\x1b[0m`;
  return { dim: wrap('muted'), accent: wrap('accent'), bold: wrap('bold') };
}

export const truncate = (s: string, max: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 3)}...` : one;
};

export const fmtMs = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
export const fmtCost = (usd: number) => (usd === 0 ? '$0' : `$${usd.toFixed(4)}`);
export const fmtTokens = (n: number) => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`);

function summarizeArgs(args: unknown): string {
  if (args === null || typeof args !== 'object')
    return args === undefined ? '' : truncate(String(args), 60);
  return truncate(
    Object.entries(args as Record<string, unknown>)
      .map(([k, v]) => `${k}=${truncate(typeof v === 'string' ? v : JSON.stringify(v), 40)}`)
      .join(' '),
    90,
  );
}

export function createTimeline(st: Styler, opts: { live: boolean }) {
  const calls = new Map<string, { tool: string; args: unknown }>();
  let t0: number | undefined;

  const learn = (e: StoredEvent) => {
    if (e.event.type === 'model.responded')
      for (const c of e.event.calls) calls.set(c.callId, { tool: c.tool, args: c.args });
  };
  const nameOf = (id: string) => calls.get(id)?.tool ?? id;

  function body(e: StoredEvent): string | undefined {
    const ev = e.event;
    switch (ev.type) {
      case 'model.responded': {
        const what = ev.calls.length
          ? ev.calls.map((c) => c.tool).join(', ')
          : truncate(ev.text ?? '', 100) || 'no action';
        const stats = `${fmtTokens(ev.usage.inTokens)} in, ${fmtTokens(ev.usage.outTokens)} out, ${fmtCost(ev.costUsd)}, ${fmtMs(ev.latencyMs)}`;
        return `step ${ev.step}  ${what}  ${st.dim(stats)}`;
      }
      case 'model.failed':
        return `model failed (attempt ${ev.attempt}): ${truncate(ev.error, 120)}`;
      case 'policy.decided':
        if (ev.decision.kind === 'allow' && ev.decision.via === 'standing')
          return `allowed ${nameOf(ev.callId)} ${st.dim(`(${ev.decision.reason ?? 'standing approval'}; undo with remy approvals)`)}`;
        return ev.decision.kind === 'deny'
          ? `blocked ${nameOf(ev.callId)}: ${ev.decision.reason}`
          : undefined;
      case 'approval.requested':
        return opts.live
          ? undefined
          : `needs approval: ${ev.preview} ${st.dim(`(${ev.risk}; ${ev.reason})`)}`;
      case 'approval.resolved':
        return `${ev.granted ? 'approved' : 'denied'} ${nameOf(ev.callId)} ${st.dim(`by ${ev.by}`)}`;
      case 'tool.started': {
        const c = calls.get(ev.callId);
        const retry = ev.attempt > 1 ? st.dim(` (attempt ${ev.attempt})`) : '';
        return `  ${c?.tool ?? ev.callId} ${st.dim(summarizeArgs(c?.args))}${retry}`;
      }
      case 'tool.completed': {
        const r = ev.result;
        if (!r.ok) return `    failed: ${truncate(r.error, 100)} ${st.dim(fmtMs(ev.latencyMs))}`;
        const line = r.content.split('\n').find((l) => l.trim()) ?? '';
        const size = r.content.length > 80 ? st.dim(` (${r.content.length} chars)`) : '';
        return `    ${st.dim('->')} ${truncate(line, 80)}${size} ${st.dim(fmtMs(ev.latencyMs))}`;
      }
      case 'tool.failed':
        return `    ${ev.retryable ? 'will retry' : 'failed'}: ${truncate(ev.error, 100)}`;
      case 'tool.reconciled':
        return `  checked ${nameOf(ev.callId)} after a restart: ${ev.outcome.replace('_', ' ')}`;
      case 'user.asked':
        return opts.live ? undefined : `asked you: ${truncate(ev.question, 120)}`;
      case 'user.answered':
        return `you answered: ${truncate(ev.answer, 120)}`;
      case 'budget.exhausted':
        return `paused at the ${ev.limit} limit after ${ev.steps} steps and $${ev.costUsd.toFixed(2)}`;
      case 'budget.extended':
        return `continued by ${ev.by}: now up to ${ev.maxSteps} steps and $${ev.maxCostUsd.toFixed(2)}`;
      case 'progress':
        return st.dim(`progress: ${ev.text}`);
      case 'task.cancel_requested':
        return `cancel requested by ${ev.by}`;
      case 'task.finished':
        if (opts.live) return undefined;
        return `${ev.status}: ${truncate(ev.answer ?? ev.reason ?? '', 120)}`.trimEnd();
      default:
        return undefined;
    }
  }

  return {
    seed(events: StoredEvent[]) {
      for (const e of events) learn(e);
    },
    line(e: StoredEvent): string | undefined {
      learn(e);
      t0 ??= Date.parse(e.at);
      const text = body(e);
      if (text === undefined) return undefined;
      if (opts.live) return text;
      return `${st.dim(`+${((Date.parse(e.at) - t0) / 1000).toFixed(1)}s`.padStart(7))}  ${text}`;
    },
  };
}

export function totalsLine(events: StoredEvent[], s: TaskState, st: Styler): string {
  let model = 0;
  let tools = 0;
  for (const { event } of events) {
    if (event.type === 'model.responded') model += event.latencyMs;
    if (event.type === 'tool.completed') tools += event.latencyMs;
  }
  return st.dim(
    `${s.step} steps, ${fmtTokens(s.usage.inTokens)} in, ${fmtTokens(s.usage.outTokens)} out, ${fmtCost(s.costUsd)}, model ${fmtMs(model)}, tools ${fmtMs(tools)}`,
  );
}
