import { useState } from 'react';
import type { SkillItem } from '../../api/index.tsx';
import { BrainTabs } from '../../components/BrainTabs.tsx';
import { Eyebrow, Loading, mono, Notice, primary, quiet, Unavailable, useLoad } from './ui.tsx';

const TAG: Record<SkillItem['source'], string> = {
  yours: 'Yours',
  learned: 'Learned from you',
  builtin: 'Built in',
};

export function Skills() {
  const { api, data, setData, error } = useLoad((a) => a.skills());
  const [name, setName] = useState<string | null>(null);
  const [said, setSaid] = useState<{ text: string; taskId?: string } | null>(null);
  if (error) return <Unavailable message={error} />;
  if (!data) return <Loading />;

  const mine = data.skills.filter((s) => s.source !== 'builtin');
  const builtin = data.skills.filter((s) => s.source === 'builtin');
  const skill = data.skills.find((s) => s.name === name) ?? data.skills[0];
  const refresh = async () => setData(await api.skills());
  const fail = (e: unknown) =>
    setSaid({
      text:
        e instanceof Error
          ? e.message
          : 'That did not work. Check that Remy is still running, then try again.',
    });

  return (
    <div className="grid min-h-[calc(100vh-66px)] lg:grid-cols-[460px_minmax(0,1fr)]">
      <div className="min-w-0 border-b border-edge px-5 py-8 sm:px-8 lg:border-r lg:border-b-0 lg:pr-8 lg:pl-14">
        <BrainTabs current="skills" />
        <h1 className="m-0 text-[30px] font-normal leading-tight">Skills</h1>
        <p className="mt-3 mb-6 text-base text-muted">
          How you like things done, saved so Remy does them the same way every time.
        </p>
        <SkillGroup title="Yours" skills={mine} current={skill?.name} onPick={setName} />
        <SkillGroup title="Built in" skills={builtin} current={skill?.name} onPick={setName} />
        {data.suggestion && (
          <section
            aria-labelledby="suggested-h"
            className="mt-6 rounded-[10px] border border-edge-hi bg-surface p-4"
          >
            <h2 id="suggested-h" className={`${mono} m-0 text-[12px] font-normal text-signal`}>
              Suggested
            </h2>
            <p className="mt-2 mb-3 text-[14px] leading-relaxed text-muted">
              {data.suggestion.text}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primary}
                onClick={() => api.resolveSuggestion(true).then(refresh, fail)}
              >
                Save as a skill
              </button>
              <button
                type="button"
                className={quiet}
                onClick={() => api.resolveSuggestion(false).then(refresh, fail)}
              >
                Not now
              </button>
            </div>
          </section>
        )}
      </div>

      <div className="min-w-0 px-5 py-8 sm:px-8 lg:px-14">
        {skill ? (
          <article aria-labelledby="skill-h">
            <h2 id="skill-h" className={`${mono} m-0 text-[26px] font-bold leading-tight`}>
              {skill.name}
            </h2>
            <p
              className={`${mono} mt-3 mb-6 flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted`}
            >
              <span>
                Used {skill.used} {skill.used === 1 ? 'time' : 'times'}
              </span>
              {skill.lastRun && <span>Last run {skill.lastRun}</span>}
              {skill.origin && <span>{skill.origin}</span>}
              {!skill.enabled && <span className="text-text">Turned off</span>}
            </p>
            <Eyebrow>Steps Remy follows</Eyebrow>
            <ol className="m-0 mt-4 mb-8 list-none p-0">
              {skill.steps.map((s, i) => (
                <li
                  key={s.title}
                  className="relative pb-5 pl-9 before:absolute before:top-3 before:bottom-0 before:left-[9px] before:w-px before:bg-stone last:before:hidden"
                >
                  <span
                    aria-hidden="true"
                    className={`${mono} absolute top-0.5 left-0 grid size-[19px] place-items-center rounded-full border border-edge-hi bg-bg text-[10px] text-muted`}
                  >
                    {i + 1}
                  </span>
                  <p className={`${mono} m-0 text-[14px] font-medium`}>{s.title}</p>
                  <p className="m-0 mt-1 text-[15px] text-muted">{s.detail}</p>
                </li>
              ))}
            </ol>
            {skill.why && (
              <section
                aria-labelledby="why-h"
                className="mb-4 max-w-[680px] rounded-[10px] border border-edge bg-surface p-4"
              >
                <h3 id="why-h" className={`${mono} m-0 mb-2 text-[12px] font-normal text-muted`}>
                  Why this skill exists
                </h3>
                <p className="m-0 text-[15px] leading-relaxed">{skill.why}</p>
              </section>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primary}
                disabled={!skill.enabled}
                onClick={() =>
                  api
                    .runSkill(skill.name)
                    .then(
                      (r) => setSaid({ text: `Started ${skill.name}.`, taskId: r.taskId }),
                      fail,
                    )
                }
              >
                Run it now
              </button>
              <button
                type="button"
                className={quiet}
                onClick={() => setSaid({ text: 'Editing steps is not available here yet.' })}
              >
                Edit steps
              </button>
              <button
                type="button"
                className={quiet}
                onClick={() => api.setSkillEnabled(skill.name, !skill.enabled).then(refresh, fail)}
              >
                {skill.enabled ? 'Turn off' : 'Turn on'}
              </button>
            </div>
            <div className="mt-3">
              <Notice>
                {said?.text}{' '}
                {said?.taskId && (
                  <a className="text-text underline" href={`#/tasks/${said.taskId}`}>
                    Open the job
                  </a>
                )}
              </Notice>
            </div>
          </article>
        ) : (
          <p className="m-0 text-base text-muted">
            No skills yet. Correct Remy once and it keeps the rule.
          </p>
        )}
      </div>
    </div>
  );
}

function SkillGroup({
  title,
  skills,
  current,
  onPick,
}: {
  title: string;
  skills: SkillItem[];
  current: string | undefined;
  onPick: (name: string) => void;
}) {
  if (skills.length === 0) return null;
  return (
    <section aria-label={title} className="mb-6">
      <div className="mb-2 flex items-baseline justify-between">
        <Eyebrow>{title}</Eyebrow>
        <span className={`${mono} text-[12px] text-muted`}>{skills.length}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {skills.map((s) => {
          const on = s.name === current;
          return (
            <li key={s.name}>
              <button
                type="button"
                aria-current={on ? 'true' : undefined}
                onClick={() => onPick(s.name)}
                className={`block w-full cursor-pointer rounded-[10px] border bg-transparent px-3.5 py-3 text-left text-text hover:bg-surface ${on ? 'border-edge bg-surface' : 'border-transparent'}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className={`${mono} text-[14px] font-medium`}>{s.name}</span>
                  <span
                    className={`${mono} rounded-[4px] border px-1.5 py-px text-[12px] ${s.source === 'learned' ? 'border-signal text-signal' : 'border-edge-hi text-muted'}`}
                  >
                    {TAG[s.source]}
                  </span>
                </span>
                <span className="mt-1 block text-[14px] text-muted">{s.blurb}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
