// Copies a command, or shows it when the browser will not let the page write to the clipboard.
// A browser that asks permission and never answers would leave the button looking dead, so the
// command is shown after a moment either way.
import { useEffect, useRef, useState } from 'react';

const chip =
  'cursor-pointer rounded-full border border-edge bg-transparent px-3 py-1.5 text-[12px] whitespace-nowrap text-muted hover:text-text';

export function CopyCommand({
  command,
  title,
  label = 'Copy command',
  what = 'add',
}: {
  command: string;
  title: string;
  label?: string;
  what?: string;
}) {
  const [state, setState] = useState<'idle' | 'done' | 'failed'>('idle');
  const settled = useRef(false);
  useEffect(() => {
    if (state !== 'done') return;
    const t = setTimeout(() => setState('idle'), 2000);
    return () => clearTimeout(t);
  }, [state]);
  if (state === 'failed')
    return <code className="font-mono block text-[12px] break-all text-muted">{command}</code>;
  const copy = () => {
    settled.current = false;
    const give = (next: 'done' | 'failed') => {
      if (settled.current) return;
      settled.current = true;
      setState(next);
    };
    const slow = setTimeout(() => give('failed'), 3000);
    navigator.clipboard.writeText(command).then(
      () => {
        clearTimeout(slow);
        give('done');
      },
      () => {
        clearTimeout(slow);
        give('failed');
      },
    );
  };
  return (
    <button
      type="button"
      className={chip}
      aria-label={`Copy the command to ${what} ${title}`}
      onClick={copy}
    >
      {state === 'done' ? 'Copied' : label}
    </button>
  );
}
