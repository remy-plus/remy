// Small pieces shared by the connections, skills, schedules and brain screens.
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { type RemyApi, useApi } from '../../api/index.tsx';
import dropbox from '../../assets/logos/dropbox.svg';
import figma from '../../assets/logos/figma.svg';
import gmail from '../../assets/logos/gmail.svg';
import calendar from '../../assets/logos/google-calendar.svg';
import drive from '../../assets/logos/google-drive.svg';
import linear from '../../assets/logos/linear.svg';
import notion from '../../assets/logos/notion.svg';
import octocat from '../../assets/logos/octocat.svg';
import slack from '../../assets/logos/slack.svg';
import stripe from '../../assets/logos/stripe.svg';
import zoom from '../../assets/logos/zoom.svg';
import { Skeleton } from '../../components/Skeleton.tsx';
import { describeError } from '../../lib/errors.ts';

export const mono = 'font-mono';
const base = `cursor-pointer rounded-full border px-4 py-[8px] text-[14px] font-medium whitespace-nowrap transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.97] disabled:cursor-default disabled:opacity-50 no-underline`;
export const quiet = `${base} inline-block border-edge-hi bg-transparent text-text hover:bg-raise`;
export const primary = `${base} inline-block border-text btn-solid`;
export const field =
  'w-full rounded-[10px] border border-edge bg-surface px-4 py-2.5 text-[15px] text-text placeholder:text-muted aria-[invalid=true]:border-[#d98b7a]';

/** Loads once from the adapter. A server that cannot answer yields a plain sentence in `error`. */
export function useLoad<T>(load: (api: RemyApi) => Promise<T>) {
  const api = useApi();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` is a stable method reference
  const reload = useCallback(() => {
    load(api)
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: unknown) =>
        setError(
          describeError(e, 'Remy could not be reached. Check that it is running, then reload.'),
        ),
      );
  }, [api]);
  useEffect(reload, [reload]);
  return { api, data, setData, error, reload };
}

/** The page frame: a title block, then the main column and a side column with a rule on its left. */
export function Page({
  title,
  lead,
  crumb,
  aside,
  children,
  asideWidth = 'lg:grid-cols-[minmax(0,1fr)_400px]',
  tabs,
}: {
  title: string;
  lead?: string;
  crumb?: string;
  aside?: ReactNode;
  children: ReactNode;
  asideWidth?: string;
  /** A section switcher above the title. It belongs inside the column, so it lines up with the title. */
  tabs?: ReactNode;
}) {
  return (
    <div className={`grid min-h-[calc(100vh-66px)] ${aside ? asideWidth : ''}`}>
      <div className="min-w-0 px-5 py-8 sm:px-8 lg:pr-12 lg:pl-14">
        {tabs}
        {crumb && (
          <p className={`${mono} m-0 mb-3 text-[12px] text-muted`}>
            <a href="#/connections" className="text-text underline">
              Connections
            </a>{' '}
            / {crumb}
          </p>
        )}
        <h1 className="m-0 text-[30px] font-normal leading-tight">{title}</h1>
        {lead && <p className="mt-3 mb-6 max-w-[560px] text-base text-muted">{lead}</p>}
        {children}
      </div>
      {aside && (
        <aside className="min-w-0 border-t border-edge px-5 py-8 sm:px-8 lg:border-t-0 lg:border-l">
          {aside}
        </aside>
      )}
    </div>
  );
}

/** What went wrong, in the server's own words when it has them, with a way to try again. */
export function Unavailable({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="status" className="px-5 py-12 sm:px-8">
      <p className="m-0 max-w-[560px] text-base leading-relaxed text-text">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className={`${quiet} mt-4`}>
          Try again
        </button>
      )}
    </div>
  );
}

/** The page taking shape, named, so the wait says what it is for. */
export function Loading({ label = 'Loading this page' }: { label?: string }) {
  return <Skeleton label={label} lines={4} className="px-5 py-12 sm:px-8" />;
}

/** A real switch: a native checkbox with the switch role, so the keyboard works without extra code. */
export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  label: string;
}) {
  return (
    <input
      type="checkbox"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="relative m-0 h-6 w-10 shrink-0 cursor-pointer appearance-none rounded-full border border-edge-hi bg-transparent transition-colors before:absolute before:top-[3px] before:left-[3px] before:size-4 before:rounded-full before:bg-text before:transition-transform checked:border-signal checked:bg-signal checked:before:translate-x-4 checked:before:bg-signal-ink"
    />
  );
}

export function Eyebrow({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className={`${mono} m-0 text-[12px] font-normal text-muted`}>
      {children}
    </h2>
  );
}

const LOGOS: Record<string, { src: string; light?: boolean }> = {
  gmail: { src: gmail },
  calendar: { src: calendar },
  notion: { src: notion, light: true },
  slack: { src: slack },
  github: { src: octocat },
  linear: { src: linear, light: true },
  drive: { src: drive },
  dropbox: { src: dropbox },
  stripe: { src: stripe },
  zoom: { src: zoom },
  figma: { src: figma },
};

/** The first letter or digit of a name, uppercased; a neutral dot when it has none. */
export function monogram(name: string): string {
  const m = name.match(/[\p{L}\p{N}]/u);
  return m ? m[0].toUpperCase() : '·';
}

/**
 * An app's mark in a small tile. Decorative: the name always sits beside it. With no bundled mark
 * it shows a registry `icon` (https only, checked by the caller) when given, and otherwise the
 * name's first letter, so a list of apps stays recognisable at a glance.
 */
export function AppLogo({
  id,
  name,
  icon,
  size = 28,
}: {
  id: string;
  name: string;
  icon?: string;
  size?: number;
}) {
  const logo = LOGOS[id];
  const [broken, setBroken] = useState(false);
  const remote = !logo && icon?.startsWith('https://') && !broken ? icon : undefined;
  return (
    <span
      aria-hidden="true"
      style={{ width: size + 12, height: size + 12 }}
      className={`grid shrink-0 place-items-center rounded-md border border-edge ${logo?.light ? 'bg-[#edebe6]' : 'bg-raise'}`}
    >
      {logo ? (
        <img src={logo.src} alt="" width={size - 8} height={size - 8} />
      ) : remote ? (
        <img
          src={remote}
          alt=""
          width={size - 8}
          height={size - 8}
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        <span data-monogram className={`${mono} text-[13px] leading-none text-muted`}>
          {monogram(name)}
        </span>
      )}
    </span>
  );
}

/** What a change tells the person, announced politely. */
export function Notice({ children }: { children?: ReactNode }) {
  return (
    <p role="status" className={`${mono} m-0 min-h-5 text-[12px] text-muted`}>
      {children}
    </p>
  );
}
