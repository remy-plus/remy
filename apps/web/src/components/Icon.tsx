// One icon set for the whole app: 16 px, 1.6 stroke, round caps, currentColor. A mixed set (different
// weights, one filled and one not, a text glyph beside a drawn one) is one of the fastest ways to look
// thrown together, so every mark in the app comes from here.

export type IconName =
  | 'send'
  | 'mic'
  | 'speak'
  | 'mute'
  | 'stop'
  | 'check'
  | 'close'
  | 'plus'
  | 'clock'
  | 'chevron-down'
  | 'arrow-right';

/** The few marks that read better solid than drawn. */
const FILLED = new Set<IconName>(['stop']);

const PATHS: Record<IconName, React.ReactNode> = {
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  speak: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9v6h4l5 4V5L8 9H4z" />
      <path d="M17 9l5 6M22 9l-5 6" />
    </>
  ),
  stop: <rect x="7" y="7" width="10" height="10" rx="2" />,
  check: <path d="M5 13l4 4L19 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'arrow-right': <path d="M5 12h14M13 6l6 6-6 6" />,
};

/** A mark. Decorative: the button or line around it always carries the words. */
export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const filled = FILLED.has(name);
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
