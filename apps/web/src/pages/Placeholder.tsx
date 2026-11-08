/** A page that is not built yet. It says so plainly. */
export function Placeholder({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8">
      <h1 className="m-0 font-sans text-[32px] font-normal leading-tight text-text">{title}</h1>
      <p className="mt-3 font-sans text-base text-muted">
        {detail ?? 'This screen is not built yet.'}
      </p>
    </div>
  );
}
