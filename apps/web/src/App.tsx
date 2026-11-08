import { useEffect, useRef } from 'react';
import { useApi } from './api/index.tsx';
import { Header } from './components/Header.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { useHome } from './hooks.ts';
import { Home } from './pages/Home.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { matchRoute, useHashPath } from './router.ts';

function Page({ path, home }: { path: string; home: ReturnType<typeof useHome> }) {
  const { name, params } = matchRoute(path);
  switch (name) {
    case 'home':
      return <Home home={home} />;
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
  const api = useApi();
  const home = useHome();
  const main = useRef<HTMLElement>(null);
  const shown = useRef(path);
  // After a navigation, move focus to the page so keyboard and screen reader users start at the top.
  // Comparing paths (not a first-run flag) keeps StrictMode's double effect from focusing on load.
  useEffect(() => {
    if (shown.current === path) return;
    shown.current = path;
    main.current?.focus();
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
      <Header
        path={path}
        status={home.data && <StatusBar status={home.data.status} sample={api.kind === 'mock'} />}
      />
      <main id="main" ref={main} tabIndex={-1} className="outline-none">
        <Page path={path} home={home} />
      </main>
    </>
  );
}
