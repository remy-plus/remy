import type { HomeData } from '../api/index.tsx';

/** The right side of the bar: what is running and how Remy is set. */
export function StatusBar({ status, sample }: { status: HomeData['status']; sample: boolean }) {
  const bits = [
    status.machinesUp !== null && `${status.machinesUp} machines up`,
    status.notes !== null && `${status.notes.toLocaleString('en')} notes linked`,
  ].filter(Boolean);
  return (
    <p className="m-0 flex items-center justify-end gap-4 whitespace-nowrap">
      {sample && <span className="text-stone">Sample data</span>}
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
        <span>
          <span className="text-text">{status.running}</span> running
        </span>
      </span>
      {bits.map((b) => (
        <span key={String(b)} className="hidden min-[1400px]:inline">
          {b}
        </span>
      ))}
      <span>Trust: {status.trust}</span>
      <span className="hidden rounded-full border border-edge px-3 py-1 min-[1400px]:inline">
        Quiet: {status.quiet ? 'on' : 'off'}
      </span>
      <span>{status.time}</span>
    </p>
  );
}
