// A loading state that says what is coming, in the shape of what is coming. A bare spinner, or the
// word "Loading", leaves the person guessing; a skeleton that names the thing does not.

/** The widths of the placeholder lines, so a block reads like text rather than a grey box. */
const WIDTHS = ['92%', '78%', '64%', '86%', '70%'];

/** Stable ids for the placeholders: they never reorder, so a position is a fine identity. */
const IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/**
 * `lines` is a paragraph taking shape; `rows` is a list of things (activity, chats) taking shape.
 * The label is read out once and is the only thing a screen reader gets.
 */
export function Skeleton({
  label,
  lines = 3,
  variant = 'lines',
  className = '',
}: {
  label: string;
  lines?: number;
  variant?: 'lines' | 'rows';
  className?: string;
}) {
  const count = Math.min(Math.max(1, lines), IDS.length);
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-2.5">
        {IDS.slice(0, count).map((id, i) => {
          const width = WIDTHS[i % WIDTHS.length];
          return variant === 'rows' ? (
            <span key={id} className="flex items-baseline justify-between gap-6 py-2">
              <span className="skeleton block h-3.5 rounded-full" style={{ width }} />
              <span className="skeleton block h-3 w-16 shrink-0 rounded-full" />
            </span>
          ) : (
            <span key={id} className="skeleton block h-3.5 rounded-full" style={{ width }} />
          );
        })}
      </div>
    </div>
  );
}
