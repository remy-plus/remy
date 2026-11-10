import { useEffect, useRef } from 'react';
import { useApi } from './api/index.tsx';
import { CommandPalette } from './components/CommandPalette.tsx';
import { Dock } from './components/Dock.tsx';
import { PushToTalk } from './components/PushToTalk.tsx';
import { Activity } from './pages/activity/Activity.tsx';
import { Browser } from './pages/browser/Browser.tsx';
import { Chat } from './pages/chat/Chat.tsx';
import { AddConnection } from './pages/connect/AddConnection.tsx';
import { AddMachine } from './pages/connect/AddMachine.tsx';
import { Brain } from './pages/connect/Brain.tsx';
import { Connections } from './pages/connect/Connections.tsx';
import { NewSchedule } from './pages/connect/NewSchedule.tsx';
import { Schedules } from './pages/connect/Schedules.tsx';
import { Skills } from './pages/connect/Skills.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { Settings } from './pages/settings/Settings.tsx';
import { Review } from './pages/tasks/Review.tsx';
import { Task } from './pages/tasks/Task.tsx';
import { Quiet } from './pages/welcome/Quiet.tsx';
import { SignIn } from './pages/welcome/SignIn.tsx';
import { useFirstRun } from './pages/welcome/useFirstRun.ts';
import { Welcome } from './pages/welcome/Welcome.tsx';
import { matchRoute, useHashPath } from './router.ts';
import { applyServerPrefs, bindServerSettings } from './settings.ts';

/** Old addresses move to their new home without leaving a step in the back button. */
function Redirect({ to }: { to: string }) {
  useEffect(() => window.location.replace(to), [to]);
  return null;
}

function Page({ path }: { path: string }) {
  const { name, params } = matchRoute(path);
  switch (name) {
    case 'home':
      return <Chat />;
    case 'chat':
      return <Chat id={params.id} />;
    case 'activity':
      return <Activity />;
    case 'browser':
      return <Browser />;
    case 'tasks':
      return <Redirect to="#/activity" />;
    case 'task':
      return <Task id={params.id} />;
    case 'review':
      return <Review />;
    case 'brain':
      return <Brain />;
    case 'skills':
      return <Skills />;
    case 'schedules':
      return <Schedules />;
    case 'schedule-new':
      return <NewSchedule />;
    case 'connections':
      return <Connections />;
    case 'connection-add':
      return <AddConnection />;
    case 'machine-add':
      return <AddMachine />;
    case 'settings':
      return <Settings />;
    case 'settings-section':
      return <Settings section={params.section} />;
    case 'welcome':
      return <Welcome step={params.step} />;
    case 'sign-in':
      return <SignIn />;
    case 'quiet':
      return <Quiet />;
    default:
      return <Placeholder title="Not found" detail="There is no such page." />;
  }
}

/** These screens are full-page, as in the frames: no bar across the top. */
const BARE = new Set(['welcome', 'sign-in', 'quiet']);

export function App() {
  const path = useHashPath();
  useFirstRun(path);
  const api = useApi();
  const bare = BARE.has(matchRoute(path).name);
  const main = useRef<HTMLElement>(null);
  const shown = useRef(path);
  // With a real server, copy its saved settings in once, then write each change back.
  useEffect(() => {
    if (api.kind !== 'http') return;
    let live = true;
    api
      .settings()
      .then((d) => {
        if (!live) return;
        if (d.prefs) applyServerPrefs(d.prefs);
        bindServerSettings((patch) => void api.updateSettings(patch).catch(() => {}));
      })
      .catch(() => {}); // the Settings screen says what is missing
    return () => {
      live = false;
      bindServerSettings(null);
    };
  }, [api]);
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
      {bare || <Dock path={path} />}
      <main
        id="main"
        ref={main}
        tabIndex={-1}
        className={`outline-none pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] ${bare ? '' : 'pt-20'}`}
      >
        <div key={path} className="page-in">
          <Page path={path} />
        </div>
      </main>
      <CommandPalette />
      <PushToTalk />
    </>
  );
}
