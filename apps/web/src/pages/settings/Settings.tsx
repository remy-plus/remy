import { type ComponentType, useCallback, useEffect, useState } from 'react';
import { type SettingsData, useApi } from '../../api/index.tsx';
import { Budget, Trust } from './basics.tsx';
import { DockSection } from './dock.tsx';
import { Memory } from './memory.tsx';
import { Model } from './model.tsx';
import { Notifications } from './notifications.tsx';
import { SECTION_ALIASES, SECTIONS, type SectionId, type SectionProps } from './sections.ts';
import { Computer } from './server.tsx';

const VIEWS: Partial<Record<SectionId, ComponentType<SectionProps>>> = {
  dock: DockSection,
  trust: Trust,
  budget: Budget,
  memory: Memory,
  computer: Computer,
  model: Model,
  notifications: Notifications,
};

const isSection = (s: string): s is SectionId => SECTIONS.some((x) => x.id === s);

/** Settings: a list of sections on the left, the chosen one on the right. On a phone the list goes on top. */
export function Settings({ section = 'dock' }: { section?: string }) {
  const api = useApi();
  const [data, setData] = useState<SettingsData | null>(null);
  const [n, setN] = useState(0);
  const reload = useCallback(() => setN((x) => x + 1), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `n` is the reload counter
  useEffect(() => {
    let live = true;
    api
      .settings()
      .then((d) => live && setData(d))
      .catch(() => live && setData(null)); // the sections say what is missing
    return () => {
      live = false;
    };
  }, [api, n]);

  const wanted = SECTION_ALIASES[section] ?? section;
  const current = isSection(wanted) ? wanted : null;
  const View = current ? VIEWS[current] : undefined;
  const label = SECTIONS.find((s) => s.id === current)?.label;

  return (
    <div className="mx-auto max-w-[1440px] md:grid md:min-h-[calc(100vh-66px)] md:grid-cols-[260px_minmax(0,1fr)]">
      <nav
        aria-label="Settings sections"
        className="border-b border-edge px-5 py-4 md:border-r md:border-b-0 md:py-8 md:pr-5 md:pl-10"
      >
        <ul className="-mx-3 m-0 flex flex-wrap gap-1 p-0 md:mx-0 md:block md:space-y-1">
          {SECTIONS.map((s) => {
            const on = s.id === (current ?? '');
            return (
              <li key={s.id} className="list-none">
                <a
                  href={`#/settings/${s.id}`}
                  aria-current={on ? 'true' : undefined} // the main bar already marks Settings as the page
                  className={`block rounded-xl border px-3.5 py-2.5 text-[15px] font-medium no-underline transition-colors duration-300 ${on ? 'border-edge bg-surface text-text' : 'border-transparent text-muted hover:text-text'}`}
                >
                  {s.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="min-w-0 px-5 pt-8 pb-16 md:px-14 md:pt-9">
        <div className="max-w-[1052px]">
          <h1 className="sr-only">Settings</h1>
          <h2 className="m-0 mb-7 text-[32px] leading-tight font-normal tracking-tight">
            {label ?? 'Settings'}
          </h2>
          {View ? (
            <View data={data} reload={reload} />
          ) : (
            <p className="m-0 text-[15px] text-muted">
              {current ? 'This section is not built yet.' : 'There is no such section.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
