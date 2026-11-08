import { Placeholder } from '../Placeholder.tsx';

// Stub: replaced by the real screen in package 6.3.
export function Task({ id }: { id?: string }) {
  return <Placeholder title="Task" detail={id ? `Id: ${id}` : undefined} />;
}
