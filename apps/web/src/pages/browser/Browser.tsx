import { BrowserPane } from '../../components/BrowserPane.tsx';

export function Browser() {
  return (
    <div className="mx-auto max-w-[960px] px-5 pt-8 pb-16 sm:px-8">
      <h1 className="m-0 text-[32px] font-medium tracking-tight">Browser</h1>
      <p className="mt-3 mb-6 text-[16px] text-muted">
        This is Remy's own browser, shown live while it works on the web for you.
      </p>
      <BrowserPane />
    </div>
  );
}
