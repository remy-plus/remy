// Standing approvals ("always allow this tool"), kept per user in REMY_HOME/approvals.json.
//
// The file only names tools. Whether a name counts is decided by the policy in core, which looks
// at the tool's real risk: a hand-edited entry for a tool that spends money or cannot be undone
// is ignored there. This module also refuses to write such an entry, so the file stays honest.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canStandingAllow, type Risk } from '@remy/core';
import { z } from 'zod';

const entrySchema = z.object({ since: z.string().optional() });
const fileSchema = z.object({ alwaysAllow: z.record(z.string(), z.unknown()) });

export interface StandingEntry {
  tool: string;
  /** ISO time it was added, when known. */
  since?: string;
}

export interface Standing {
  entries: StandingEntry[];
  /** Set when the file was damaged or partly unreadable: what was skipped and what to do. */
  note?: string;
  /** The whole file was unusable; the next save moves it aside as approvals.json.damaged. */
  damaged?: true;
}

export interface ApprovalsStore {
  load(): Standing;
  /** Names for the policy. */
  names(): string[];
  /** Saves "always allow <tool>". Throws for a risk that cannot be allowed for good. */
  add(tool: string, risk: Risk): void;
  /** Forgets it. False when there was no such entry. */
  remove(tool: string): boolean;
}

/** Why a tool cannot be allowed for good, or undefined when it can. */
export function standingBlocker(tool: string, risk: Risk): string | undefined {
  if (canStandingAllow(risk)) return undefined;
  if (risk === 'read') return `${tool} only reads, so it never needs approval.`;
  return `${tool} ${risk === 'spend_money' ? 'spends money' : 'cannot be undone'}, so it always asks first.`;
}

const pathOf = (home: string) => join(home, 'approvals.json');

export function openApprovals(home: string, now: () => Date = () => new Date()): ApprovalsStore {
  const path = pathOf(home);

  function load(): Standing {
    if (!existsSync(path)) return { entries: [] };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      return {
        entries: [],
        damaged: true,
        note: `${path} could not be read, so no tool is allowed for good right now. Fix or delete the file; Remy asks every time until then.`,
      };
    }
    const file = fileSchema.safeParse(raw);
    if (!file.success)
      return {
        entries: [],
        damaged: true,
        note: `${path} is not in the expected shape, so no tool is allowed for good right now. Fix or delete the file; Remy asks every time until then.`,
      };
    const entries: StandingEntry[] = [];
    let skipped = 0;
    for (const [tool, value] of Object.entries(file.data.alwaysAllow)) {
      const e = entrySchema.safeParse(value ?? {});
      if (!e.success || !tool) skipped += 1;
      else entries.push({ tool, ...(e.data.since && { since: e.data.since }) });
    }
    return {
      entries,
      ...(skipped && {
        note: `${skipped} entr${skipped === 1 ? 'y' : 'ies'} in ${path} could not be read and ${skipped === 1 ? 'was' : 'were'} skipped.`,
      }),
    };
  }

  function save(entries: StandingEntry[], damaged: boolean) {
    mkdirSync(home, { recursive: true, mode: 0o700 });
    // A damaged file is moved aside, never silently overwritten.
    if (damaged && existsSync(path)) renameSync(path, `${path}.damaged`);
    const alwaysAllow = Object.fromEntries(
      entries.map((e) => [e.tool, e.since ? { since: e.since } : {}]),
    );
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ alwaysAllow }, null, 2)}\n`, { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, path);
  }

  return {
    load,
    names: () => load().entries.map((e) => e.tool),
    add(tool, risk) {
      const why = standingBlocker(tool, risk);
      if (why) throw new Error(why);
      const cur = load();
      if (cur.entries.some((e) => e.tool === tool)) return;
      save([...cur.entries, { tool, since: now().toISOString() }], cur.damaged === true);
    },
    remove(tool) {
      const cur = load();
      if (!cur.entries.some((e) => e.tool === tool)) return false;
      save(
        cur.entries.filter((e) => e.tool !== tool),
        cur.damaged === true,
      );
      return true;
    },
  };
}

/** The list as plain text, for `/approvals` and `remy approvals list`. */
export function plainApprovals(s: Standing, riskOf: (tool: string) => Risk | undefined): string {
  const lines = s.entries.map((e) => {
    const risk = riskOf(e.tool);
    const ignored = risk && !canStandingAllow(risk) ? ' (ignored: this tool always asks)' : '';
    return `${e.tool}${e.since ? `  since ${e.since.slice(0, 10)}` : ''}${ignored}`;
  });
  const head = lines.length
    ? lines.join('\n')
    : 'Nothing is allowed for good. Press a on an approval card to allow a tool.';
  return s.note ? `${head}\n${s.note}` : head;
}
