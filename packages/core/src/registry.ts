import { z } from 'zod';
import { RISKS, type Tool, type ToolSpec } from './types.ts';

const EFFECTS = ['none', 'idempotent', 'reconcilable', 'unsafe_to_retry'];
const NAME = /^[a-z][a-z0-9_]{0,63}$/;

/** Identity helper that infers `A` from the schema and erases it for the registry. */
export const defineTool = <A>(tool: Tool<A>): Tool => tool as Tool;

export function toolSpec(tool: Tool): ToolSpec {
  const { $schema: _, ...parameters } = z.toJSONSchema(tool.args) as Record<string, unknown>;
  return { name: tool.name, description: tool.description, parameters };
}

export class ToolRegistry {
  readonly #tools = new Map<string, Tool>();

  constructor(tools: Tool[] = []) {
    for (const t of tools) this.add(t);
  }

  add(tool: Tool): this {
    if (!NAME.test(tool.name)) throw new Error(`invalid tool name: ${tool.name}`);
    if (this.#tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    if (!RISKS.includes(tool.risk)) throw new Error(`${tool.name}: invalid risk ${tool.risk}`);
    if (!EFFECTS.includes(tool.effect))
      throw new Error(`${tool.name}: invalid effect ${tool.effect}`);
    if (tool.effect === 'reconcilable' && !tool.reconcile)
      throw new Error(`${tool.name}: reconcilable tools must implement reconcile()`);
    this.#tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name);
  }

  list(): Tool[] {
    return [...this.#tools.values()];
  }

  /** Specs for `names` in that order (unknown names are skipped), or for every tool in registry order. */
  specs(names?: string[]): ToolSpec[] {
    if (!names) return this.list().map(toolSpec);
    return names.flatMap((n) => {
      const t = this.get(n);
      return t ? [toolSpec(t)] : [];
    });
  }
}
