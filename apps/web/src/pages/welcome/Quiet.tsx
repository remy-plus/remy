// The quiet screen: the orb dims and only approvals get through. Opening it turns quiet mode on
// (`remy.quiet`); "turn off" turns it off and goes Home. Time-based quiet hours are not acted on yet.
import { useEffect, useState } from 'react';
import { type TaskListItem, useApi } from '../../api/index.tsx';
import { Orb } from '../../components/Orb.tsx';
import { buttonPrimary, buttonQuiet } from '../../components/ui.ts';
import { clock } from '../../lib/when.ts';
import { setSetting, useSetting } from '../../settings.ts';

/** "07:00" (the stored value) as "7:00 AM". */
const hhmm = (v: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v);
  return m ? clock(new Date(2000, 0, 1, Number(m[1]), Number(m[2]))) : v;
};

export function Quiet() {
  const api = useApi();
  const [until] = useSetting('quiet.to');
  const [tasks, setTasks] = useState<TaskListItem[] | null>(null);

  useEffect(() => {
    setSetting('quiet', true);
    let live = true;
    api
      .listTasks({ limit: 50 })
      .then((t) => live && setTasks(t))
      .catch(() => live && setTasks([]));
    return () => {
      live = false;
    };
  }, [api]);

  const running = tasks?.filter((t) => t.status === 'running').length ?? 0;
  const waiting = tasks?.filter((t) => t.status === 'waiting_approval') ?? [];
  const parts = [
    `${running} ${running === 1 ? 'job' : 'jobs'} running`,
    waiting.length > 0 && `${waiting.length} waiting for you`,
    'nothing else will interrupt you',
  ].filter(Boolean);
  const first = waiting[0];

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr_auto] px-5 py-6 sm:px-8">
      <p className="font-mono m-0 text-right text-[12px] text-muted">
        Quiet mode · until {hhmm(until)} ·{' '}
        <button
          type="button"
          onClick={() => {
            setSetting('quiet', false);
            window.location.hash = '#/';
          }}
          className="cursor-pointer border-0 bg-transparent px-2 py-2.5 font-mono text-[12px] text-muted underline hover:text-text"
        >
          turn off
        </button>
      </p>
      <div className="grid place-content-center justify-items-center py-10 text-center">
        <div className="h-[250px] w-[260px] max-w-full overflow-hidden opacity-45">
          <div className="w-[560px]" style={{ marginLeft: -150 }}>
            <Orb ring={false} still />
          </div>
        </div>
        <h1 className="mt-10 mb-0 text-[28px] font-medium">Quiet.</h1>
        <p className="font-mono mt-3 mb-0 max-w-[540px] text-[13px] leading-relaxed text-muted">
          {parts.join(' · ')}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {first && (
            <a
              className={`${buttonPrimary} px-4 py-3 no-underline`}
              href={`#/tasks/${encodeURIComponent(first.id)}`}
            >
              {waiting.length === 1 ? 'Review the approval' : 'Review the approvals'}
            </a>
          )}
          <a className={`${buttonQuiet} px-4 py-3 no-underline`} href="#/">
            Open Remy
          </a>
        </div>
      </div>
      <p className="font-mono m-0 text-center text-[12px] text-muted">
        Remy keeps working. Sending as you and spending money still wait for you.
      </p>
    </div>
  );
}
