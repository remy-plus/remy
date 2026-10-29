// The model's plan, read back from its `update_plan` calls. Pure.
import type { TaskState } from './state.ts';

export interface PlanStep {
  text: string;
  status: 'pending' | 'doing' | 'done' | 'skipped';
}

export const UPDATE_PLAN = 'update_plan';

/** The steps of the latest update_plan call that went through; empty when there is no plan. */
export function latestPlan(s: TaskState): PlanStep[] {
  let steps: PlanStep[] = [];
  for (const c of Object.values(s.calls)) {
    if (c.tool !== UPDATE_PLAN || !c.result?.ok) continue;
    const raw = (c.args as { steps?: unknown } | undefined)?.steps;
    if (!Array.isArray(raw)) continue;
    steps = raw.flatMap((x): PlanStep[] => {
      const o = x as { text?: unknown; status?: unknown };
      return typeof o?.text === 'string' &&
        (o.status === 'pending' ||
          o.status === 'doing' ||
          o.status === 'done' ||
          o.status === 'skipped')
        ? [{ text: o.text, status: o.status }]
        : [];
    });
  }
  return steps;
}

export const openPlanSteps = (s: TaskState): PlanStep[] =>
  latestPlan(s).filter((p) => p.status === 'pending' || p.status === 'doing');

/** Marks the error the plan gate returns, so the gate fires once per task and never loops. */
export const PLAN_GATE_PREFIX = 'Not finished yet: your plan still has open steps.';

export const planGateUsed = (s: TaskState): boolean =>
  s.planGated ||
  Object.values(s.calls).some(
    (c) =>
      c.tool === 'finish' &&
      c.result &&
      !c.result.ok &&
      c.result.error.startsWith(PLAN_GATE_PREFIX),
  );

export function planGateMessage(open: PlanStep[]): string {
  const list = open.map((p) => `- ${p.text} (${p.status})`).join('\n');
  return `${PLAN_GATE_PREFIX}\n${list}\nFinish them, or call update_plan with those steps marked skipped and a reason in the step text (for example "Compare prices: skipped, site was down"), then finish.`;
}

/** Sent back when the model stops in plain text, for example to ask whether to go on, with steps open. */
export function planGateTextMessage(open: PlanStep[]): string {
  const list = open.map((p) => `- ${p.text} (${p.status})`).join('\n');
  return `(From Remy, not the user.) ${PLAN_GATE_PREFIX}\n${list}\nThe user asked you to do this work, so do not stop to ask whether to continue: carry on with the next step now. If a step cannot be done, call update_plan with it marked skipped and a reason, then finish. Ask with ask_user only if you need something only the user knows.`;
}

/** One line for a progress note, from the plan. No model call. */
export function progressLine(s: TaskState): string {
  const plan = latestPlan(s);
  if (!plan.length) return `${s.step} steps in, $${s.costUsd.toFixed(2)} spent.`;
  const at = plan.findIndex((p) => p.status === 'doing');
  const i = at >= 0 ? at : plan.findIndex((p) => p.status === 'pending');
  const done = plan.filter((p) => p.status === 'done' || p.status === 'skipped').length;
  if (i < 0) return `All ${plan.length} steps done, finishing up.`;
  const text = (plan[i]?.text ?? '').replace(/\s+/g, ' ').trim().replace(/[.]$/, '');
  return `Step ${done + 1} of ${plan.length}: ${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
