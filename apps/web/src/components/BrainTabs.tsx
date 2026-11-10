/** The three sections that live under Brain: notes, skills and scheduled jobs. */
export type BrainSection = 'notes' | 'skills' | 'schedules';

const TABS: { id: BrainSection; label: string; href: string }[] = [
  { id: 'notes', label: 'Notes', href: '#/brain' },
  { id: 'skills', label: 'Skills', href: '#/skills' },
  { id: 'schedules', label: 'Scheduled jobs', href: '#/schedules' },
];

/** A quiet row of plain links at the top of the Brain, Skills and Scheduled jobs pages. */
export function BrainTabs({ current }: { current: BrainSection }) {
  return (
    <nav aria-label="Brain sections" className="mb-6 flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
      {TABS.map((t) => {
        const on = t.id === current;
        return (
          <a
            key={t.id}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={`pb-1 no-underline border-b ${
              on ? 'border-text text-text' : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
          </a>
        );
      })}
    </nav>
  );
}
