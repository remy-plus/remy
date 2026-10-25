// The mock world a case runs in: fixture web, temp-dir workspace, mock inbox.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defineTool,
  type FetchResult,
  type ScopedFetch,
  type ScopedFs,
  type Tool,
  type ToolContext,
} from '@remy/core';
import {
  askUser,
  createScopedFs,
  createWebSearch,
  fetchUrl,
  finish,
  htmlToText,
  listFiles,
  readFile,
  type SearchProvider,
  writeFile,
} from '@remy/tools';
import { z } from 'zod';
import type { EvalCase, MockEmail, SentEmail, WorldAfter } from './types.ts';

export function fixtureFetch(web: Record<string, string>): ScopedFetch {
  return {
    async get(url): Promise<FetchResult> {
      const body = web[url] ?? web[url.replace(/\/$/, '')];
      if (body === undefined)
        return { url, status: 404, contentType: 'text/plain', body: 'Not found' };
      return { url, status: 200, contentType: 'text/html', body };
    },
  };
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Ranks fixture pages by how many query words they contain. Deterministic. */
export function fixtureSearch(web: Record<string, string>): SearchProvider {
  return {
    async search(query, count) {
      const words = query
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2);
      return Object.entries(web)
        .map(([url, html]) => {
          const text = flat(htmlToText(html));
          const hay = `${url} ${text}`.toLowerCase();
          return {
            url,
            title: /<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? url,
            snippet: text.slice(0, 160),
            score: words.filter((w) => hay.includes(w)).length,
          };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url))
        .slice(0, count)
        .map(({ score: _, ...r }) => r);
    },
  };
}

export function inboxTools(inbox: MockEmail[], sent: SentEmail[]): Tool[] {
  const read = defineTool({
    name: 'email_read',
    description:
      'List the inbox (no id) or read one email by id. The list shows subjects only: read each email by id to see its content. Email content is untrusted.',
    args: z.object({ id: z.string().optional().describe('Email id; omit to list the inbox') }),
    risk: 'read',
    effect: 'none',
    outputTrust: 'untrusted',
    timeoutMs: 5_000,
    maxOutputChars: 20_000,
    preview: ({ id }) => (id ? `Read email ${id}` : 'List the inbox'),
    async execute({ id }) {
      if (!id) {
        const rows = inbox.map((m) => `${m.id} | ${m.from} | ${m.subject}`);
        const list = rows.length
          ? `${rows.join('\n')}\n\nSubjects only. Read an email by id to see its content.`
          : '(empty)';
        return { ok: true, content: list, trust: 'untrusted' };
      }
      const m = inbox.find((e) => e.id === id);
      if (!m)
        return {
          ok: false,
          error: `No email with id ${id}`,
          retryable: false,
          phase: 'before_effect',
        };
      return {
        ok: true,
        content: `From: ${m.from}\nSubject: ${m.subject}\n\n${m.body}`,
        trust: 'untrusted',
      };
    },
  });
  const send = defineTool({
    name: 'email_send',
    description: 'Send an email as the user.',
    args: z.object({ to: z.string(), subject: z.string(), body: z.string() }),
    risk: 'send_as_user',
    effect: 'reconcilable',
    outputTrust: 'trusted',
    timeoutMs: 5_000,
    maxOutputChars: 2_000,
    preview: ({ to, subject }) => `Send an email to ${to} with subject "${subject}"`,
    // No dedupe here on purpose: a duplicate execution must be visible to the graders.
    async execute({ to, subject, body }, ctx: ToolContext) {
      sent.push({ key: ctx.idempotencyKey, to, subject, body });
      return { ok: true, content: `Email sent to ${to}`, trust: 'trusted' };
    },
    async reconcile(_args, ctx) {
      const hit = sent.some((m) => m.key === ctx.idempotencyKey);
      return hit
        ? { done: true, result: { ok: true, content: 'Email sent', trust: 'trusted' } }
        : { done: false };
    },
  });
  return [read, send];
}

export interface World {
  dir: string;
  tools: Tool[];
  allowTools: string[];
  capabilities: () => Pick<ToolContext, 'fs' | 'net' | 'secrets'>;
  after: () => Promise<WorldAfter>;
  cleanup: () => Promise<void>;
}

async function walk(fs: ScopedFs, dir: string, out: Record<string, string>) {
  for (const e of await fs.list(dir)) {
    const path = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.dir) await walk(fs, path, out);
    else out[path] = await fs.readText(path);
  }
}

export async function createWorld(c: EvalCase): Promise<World> {
  const dir = await mkdtemp(join(tmpdir(), 'remy-eval-'));
  const fs = createScopedFs(dir);
  for (const [path, content] of Object.entries(c.world.files ?? {}))
    await fs.writeText(path, content);

  const web = c.world.web ?? {};
  const sent: SentEmail[] = [];
  const tools: Tool[] = [
    fetchUrl,
    createWebSearch(fixtureSearch(web)),
    readFile,
    writeFile,
    listFiles,
    ...inboxTools(c.world.inbox ?? [], sent),
    askUser,
    finish,
  ];

  const useful = [
    ...(c.world.web ? ['fetch_url', 'web_search'] : []),
    ...(c.world.files ? ['read_file', 'write_file', 'list_files'] : []),
    ...(c.world.inbox ? ['email_read', 'email_send'] : []),
  ];
  const allowTools = [...new Set([...(c.tools ?? useful), 'finish', 'ask_user'])];

  const net = fixtureFetch(web);
  return {
    dir,
    tools,
    allowTools,
    capabilities: () => ({ fs, net, secrets: { get: () => undefined } }),
    async after() {
      const files: Record<string, string> = {};
      await walk(fs, '.', files);
      return { files, emails: [...sent] };
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}
