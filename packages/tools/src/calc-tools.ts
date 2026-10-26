import { defineTool, type ToolResult } from '@remy/core';
import { z } from 'zod';

const fail = (e: unknown): ToolResult => ({
  ok: false,
  error: e instanceof Error ? e.message : String(e),
  retryable: false,
  phase: 'before_effect',
});

const ok = (content: string): ToolResult => ({ ok: true, content, trust: 'trusted' });

// ---------- Arithmetic: a small recursive-descent parser, no eval ----------
// expr   = term (('+' | '-') term)*
// term   = unary (('*' | '/' | '%') unary)*
// unary  = '-' unary | '+' unary | power
// power  = atom ('**' unary)?        (right associative, so -2 ** 2 is -4 and 2 ** -1 works)
// atom   = number | '(' expr ')'
type Token = { t: 'num'; v: number } | { t: 'op'; v: string };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i++;
    } else if (/[0-9.]/.test(ch)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Error(`Bad number at position ${i + 1}`);
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (src.startsWith('**', i)) {
      out.push({ t: 'op', v: '**' });
      i += 2;
    } else if ('+-*/%()'.includes(ch)) {
      out.push({ t: 'op', v: ch });
      i++;
    } else {
      throw new Error(`Unexpected character "${ch}" at position ${i + 1}`);
    }
  }
  return out;
}

export function evaluateExpression(src: string): number {
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const isOp = (v: string) => {
    const t = peek();
    return t?.t === 'op' && t.v === v;
  };

  const atom = (): number => {
    const t = toks[pos++];
    if (t?.t === 'num') return t.v;
    if (t?.t === 'op' && t.v === '(') {
      const v = expr();
      if (!isOp(')')) throw new Error('Missing closing parenthesis');
      pos++;
      return v;
    }
    throw new Error(t ? `Unexpected "${t.v}"` : 'The expression ends too early');
  };
  const power = (): number => {
    const base = atom();
    if (!isOp('**')) return base;
    pos++;
    return base ** unary();
  };
  const unary = (): number => {
    if (isOp('-')) {
      pos++;
      return -unary();
    }
    if (isOp('+')) {
      pos++;
      return unary();
    }
    return power();
  };
  const term = (): number => {
    let v = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (toks[pos++] as { v: string }).v;
      const r = unary();
      if (op === '*') v *= r;
      else if (r === 0) throw new Error('Division by zero');
      else v = op === '/' ? v / r : v % r;
    }
    return v;
  };
  const expr = (): number => {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = (toks[pos++] as { v: string }).v;
      const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  };

  if (!toks.length) throw new Error('The expression is empty');
  const v = expr();
  if (pos < toks.length) throw new Error(`Unexpected "${(toks[pos] as { v: unknown }).v}"`);
  if (!Number.isFinite(v)) throw new Error('The result is not a finite number');
  return v;
}

// ---------- Dates (UTC, ISO YYYY-MM-DD) ----------
const DAY_MS = 86_400_000;

function parseDate(s: string | undefined, name: string): number {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw new Error(`${name} must be an ISO date like 2026-03-31`);
  }
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== s) {
    throw new Error(`${name} is not a real date: ${s}`);
  }
  return ms;
}

export const calculate = defineTool({
  name: 'calculate',
  description:
    'Exact math. op "eval": evaluate "expression" (+ - * / % ** and parentheses, e.g. "(12.5 + 7) * 3"). op "days_between": days from "from" to "to" (ISO dates, YYYY-MM-DD). op "add_days": the date "days" after "date" (days may be negative). Use this instead of doing arithmetic yourself.',
  args: z.object({
    op: z.enum(['eval', 'days_between', 'add_days']),
    expression: z.string().optional().describe('For eval, e.g. "2 ** 10 / 4"'),
    from: z.string().optional().describe('For days_between, e.g. 2026-01-15'),
    to: z.string().optional().describe('For days_between, e.g. 2026-03-01'),
    date: z.string().optional().describe('For add_days, e.g. 2026-01-15'),
    days: z.number().int().optional().describe('For add_days, e.g. 30'),
  }),
  risk: 'read',
  effect: 'none',
  outputTrust: 'trusted',
  timeoutMs: 5_000,
  maxOutputChars: 2_000,
  preview: (a) =>
    a.op === 'eval'
      ? `Calculate ${a.expression ?? ''}`
      : a.op === 'days_between'
        ? `Count the days from ${a.from} to ${a.to}`
        : `Add ${a.days} days to ${a.date}`,
  async execute(a) {
    try {
      if (a.op === 'eval') {
        if (a.expression === undefined) throw new Error('eval needs "expression"');
        return ok(`${a.expression} = ${evaluateExpression(a.expression)}`);
      }
      if (a.op === 'days_between') {
        const days = (parseDate(a.to, 'to') - parseDate(a.from, 'from')) / DAY_MS;
        return ok(`${days} days from ${a.from} to ${a.to}`);
      }
      const start = parseDate(a.date, 'date');
      if (a.days === undefined) throw new Error('add_days needs "days"');
      const end = new Date(start + a.days * DAY_MS);
      if (Number.isNaN(end.getTime())) throw new Error('The resulting date is out of range');
      return ok(`${end.toISOString().slice(0, 10)} is ${a.days} days after ${a.date}`);
    } catch (e) {
      return fail(e);
    }
  },
});
