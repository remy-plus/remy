import { useEffect, useRef } from 'react';
import { createAsciiMark, createDotField } from '../lib/ascii.ts';
import { WORDMARK } from '../lib/wordmark.ts';

/**
 * The wordmark, alive: it decodes in, shimmers and heats under the pointer. The outlined SVG logo
 * stays underneath for screen readers and for when motion is off or the canvas is missing.
 */
export function AsciiMark({
  className = '',
  fallback,
}: {
  className?: string;
  fallback: React.ReactNode;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const live = useRef(false);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let mark: ReturnType<typeof createAsciiMark> = null;
    let stopped = false;
    const start = async () => {
      try {
        await document.fonts?.load('700 20px "JetBrains Mono"');
      } catch {
        // the system mono face is close enough
      }
      if (stopped) return;
      mark = createAsciiMark(canvas, WORDMARK);
      live.current = mark !== null;
      canvas.style.display = mark ? 'block' : 'none';
      const fb = canvas.parentElement?.previousElementSibling as HTMLElement | null | undefined;
      if (fb && mark) fb.style.cssText = 'position:absolute;opacity:0;pointer-events:none';
    };
    void start();
    return () => {
      stopped = true;
      mark?.destroy();
    };
  }, []);
  return (
    <div className={`relative ${className}`}>
      <div>{fallback}</div>
      <span aria-hidden="true" className="contents">
        <canvas ref={ref} className="hidden w-full" />
      </span>
    </div>
  );
}

/** A quiet halftone field. Put it behind something, faded at its edges by a mask. */
export function DotField({ className = '' }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const field = createDotField(canvas);
    if (field) canvas.style.opacity = '0.5';
    return () => field?.destroy();
  }, []);
  return (
    <span aria-hidden="true" className="contents">
      <canvas
        ref={ref}
        className={`pointer-events-none opacity-0 transition-opacity duration-[2000ms] ${className}`}
      />
    </span>
  );
}
