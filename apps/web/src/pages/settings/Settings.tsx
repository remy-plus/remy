import { Placeholder } from '../Placeholder.tsx';

// Stub: replaced by the real screen in package 6.3.
export function Settings({ section }: { section?: string }) {
  return <Placeholder title="Settings" detail={section ? `Section: ${section}` : undefined} />;
}
