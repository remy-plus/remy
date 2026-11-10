import type { CSSProperties, ReactNode } from 'react';
import type { TaskView } from '../api/index.tsx';
import { humanTool } from '../pages/tasks/format.ts';

export type StepState = 'done' | 'waiting' | 'working' | 'pending' | 'failed';

export interface Step {
  id: string;
  state: StepState;
  label: string;
  time?: string;
  /** Added after the label, for example "stopped". */
  suffix?: string;
}

/**
 * The steps of a task, from what the server knows: the request, then each call in order. A call
 * waiting for approval is the waiting step; a call that failed is the failed one.
 * `clock` turns an ISO time into the text shown.
 */
export function buildSteps(view: TaskView, clock: (iso: string) => string): Step[] {
  const steps: Step[] = [
    { id: 'request', state: 'done', label: 'Read your request', time: clock(view.createdAt) },
  ];
  const calls = [...view.calls].sort((a, b) => a.step - b.step);
  for (const c of calls) {
    if (c.tool === 'finish') continue; // the end of the task is the "Finished" step below
    const waiting = view.pendingApproval?.callId === c.callId;
    const failed = c.result ? !c.result.ok : false;
    const state: StepState = waiting
      ? 'waiting'
      : failed
        ? 'failed'
        : c.result?.ok
          ? 'done'
          : c.inFlight
            ? 'working'
            : 'pending';
    steps.push({
      id: c.callId,
      state,
      label: c.label ?? humanTool(c.tool),
      ...(c.at && { time: c.at.length > 5 ? clock(c.at) : c.at }),
      ...(failed && { suffix: 'stopped' }),
      ...(waiting && { suffix: 'waiting for your OK' }),
    });
  }
  if (view.final?.status === 'succeeded')
    steps.push({ id: 'end', state: 'done', label: 'Finished' });
  else if (view.final?.status === 'failed' && !steps.some((s) => s.state === 'failed'))
    steps.push({ id: 'end', state: 'failed', label: 'Stopped', suffix: 'stopped' });
  else if (view.running && !steps.some((s) => s.state === 'working' || s.state === 'pending'))
    steps.push({ id: 'next', state: 'working', label: 'Working on the next step' });
  return steps;
}

const WORD: Record<StepState, string> = {
  done: 'done',
  waiting: 'waiting for you',
  working: 'in progress',
  pending: 'not started',
  failed: 'stopped',
};

function Marker({ state }: { state: StepState }) {
  const base = 'absolute top-[3px] left-0 flex size-4 items-center justify-center rounded-full';
  if (state === 'done')
    return (
      <span
        aria-hidden="true"
        className={`${base} pop border border-signal bg-bg text-[10px] text-signal`}
      >
        ✓
      </span>
    );
  if (state === 'failed')
    return (
      <span
        aria-hidden="true"
        className={`${base} bg-text font-mono text-[11px] font-bold text-bg`}
      >
        !
      </span>
    );
  if (state === 'pending')
    return (
      <span aria-hidden="true" className={`${base} bg-bg font-mono text-[13px] text-muted`}>
        :
      </span>
    );
  return (
    <span aria-hidden="true" className={`${base} bg-bg`}>
      <span
        className={`size-2.5 rounded-full bg-text ${state === 'working' ? 'opacity-60' : ''}`}
      />
    </span>
  );
}

/** The trace: an ordered list with a 1px stone line behind the markers. Each step may carry a card. */
export function Trace({
  steps,
  cards = {},
}: {
  steps: Step[];
  /** Content shown under a step, by step id: an approval card, the failure explanation. */
  cards?: Record<string, ReactNode>;
}) {
  return (
    <ol aria-label="What Remy did, step by step" className="m-0 list-none p-0">
      {steps.map((s, i) => (
        <li
          key={s.id}
          style={{ '--i': Math.min(i, 8) } as CSSProperties}
          className={`rise relative min-w-0 pl-8 ${i < steps.length - 1 ? 'pb-4' : ''} ${
            i < steps.length - 1
              ? 'before:absolute before:top-[22px] before:bottom-[-3px] before:left-[7.5px] before:w-px before:bg-stone'
              : ''
          }`}
        >
          <Marker state={s.state} />
          <p
            className={`m-0 text-[15px] leading-[1.6] ${s.state === 'pending' ? 'text-muted' : 'text-text'}`}
          >
            <span className="font-medium">{s.label}</span>
            <span className="sr-only"> ({WORD[s.state]})</span>
            {s.time && (
              <span className="ml-2 font-mono text-[12px] font-normal text-muted">{s.time}</span>
            )}
            {s.suffix && <span className="font-normal text-muted"> · {s.suffix}</span>}
          </p>
          {cards[s.id]}
        </li>
      ))}
    </ol>
  );
}
