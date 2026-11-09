import type { ReactNode } from 'react';

export const NAV = [
  { label: 'Home', href: '#/', match: (p: string) => p === '/' },
  {
    label: 'Tasks',
    href: '#/tasks',
    match: (p: string) => p === '/tasks' || p.startsWith('/tasks/') || p.startsWith('/schedules'),
  },
  {
    label: 'Brain',
    href: '#/brain',
    match: (p: string) => p === '/brain' || p === '/skills',
  },
  {
    label: 'Connections',
    href: '#/connections',
    match: (p: string) => p === '/connections' || p.startsWith('/connections/'),
  },
  {
    label: 'Settings',
    href: '#/settings',
    match: (p: string) => p === '/settings' || p.startsWith('/settings/'),
  },
] as const;

/** The bar: logo, the five places, and a status slot on the right. */
export function Header({ path, status }: { path: string; status?: ReactNode }) {
  return (
    <header className="grid items-center gap-x-4 gap-y-3 px-5 py-3 md:h-[66px] md:grid-cols-[auto_minmax(0,1fr)_auto] md:py-0 sm:px-8">
      <a href="#/" className="justify-self-start" aria-label="Remy, home">
        <span className="font-mono text-[18px] font-bold tracking-[0.06em] text-text">REMY</span>
      </a>
      <nav
        aria-label="Main"
        className="flex flex-wrap gap-x-5 gap-y-1 text-[14px] font-medium md:flex-nowrap md:justify-self-center md:gap-x-6"
      >
        {NAV.map((item) => {
          const current = item.match(path);
          return (
            <a
              key={item.label}
              href={item.href}
              aria-current={current ? 'page' : undefined}
              className={`border-b py-1 ${current ? 'border-text text-text' : 'border-transparent text-muted hover:text-text'}`}
            >
              {item.label}
            </a>
          );
        })}
      </nav>
      <div className="hidden justify-self-end font-mono text-[12px] text-muted lg:block">
        {status}
      </div>
    </header>
  );
}
