import { useEffect, useRef } from 'react';
import { Header } from './components/Header.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { matchRoute, useHashPath } from './router.ts';

function Page({ path }: { path: string }) {
  const { name, params } = matchRoute(path);
  switch (name) {
    case 'home':
      return <Placeholder title="Home" />;
    case 'tasks':
      return <Placeholder title="Tasks" />;
    case 'task':
      return <Placeholder title="Task" detail={`Task ${params.id}`} />;
    case 'brain':
      return <Placeholder title="Brain" />;
    case 'skills':
      return <Placeholder title="Skills" />;
    case 'schedules':
      return <Placeholder title="Schedules" />;
    case 'connections':
      return <Placeholder title="Connections" />;
    case 'settings':
      return <Placeholder title="Settings" />;
    case 'settings-section':
      return <Placeholder title="Settings" detail={`Section: ${params.section}`} />;
    default:
      return <Placeholder title="Not found" detail="There is no such page." />;
  }
}

export function App() {
  const path = useHashPath();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);
  // After a navigation, move focus to the page so keyboard and screen reader users start at the top.
  // biome-ignore lint/correctness/useExhaustiveDependencies: it must run when the path changes
  useEffect(() => {
    if (first.current) first.current = false;
    else main.current?.focus();
  }, [path]);
  return (
    <>
      {/* biome-ignore lint/a11y/useValidAnchor: a plain "#main" link would change the route, so the click moves focus instead */}
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          main.current?.focus();
        }}
      >
        Skip to main content
      </a>
      <Header path={path} />
      <main id="main" ref={main} tabIndex={-1} className="outline-none">
        <Page path={path} />
      </main>
    </>
  );
}
