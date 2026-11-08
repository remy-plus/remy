import { Placeholder } from '../Placeholder.tsx';

// Stub: replaced by the real screen in package 6.3.
export function Welcome({ step }: { step?: string }) {
  return <Placeholder title="Welcome" detail={step ? `Step: ${step}` : undefined} />;
}
