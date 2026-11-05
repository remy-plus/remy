// Stopping a running task from outside. SIGTERM needs handling here: without it Playwright takes
// the signal, closes its browser and leaves Remy running, and the next step opens a new browser.
const EXIT_CODES = { SIGINT: 130, SIGTERM: 143 } as const;

interface Proc {
  on(signal: string, listener: () => void): unknown;
  off(signal: string, listener: () => void): unknown;
  exit(code: number): void;
}

/** Calls `handler` on the first stop signal, then exits. Returns a function that stops listening. */
export function onStopSignals(proc: Proc, handler: () => Promise<void>): () => void {
  let stopping = false;
  const stop = (code: number) => {
    if (stopping) return;
    stopping = true;
    void handler()
      .catch(() => {})
      .finally(() => proc.exit(code));
  };
  const listeners = Object.entries(EXIT_CODES).map(([signal, code]) => {
    const listener = () => stop(code);
    proc.on(signal, listener);
    return [signal, listener] as const;
  });
  return () => {
    for (const [signal, listener] of listeners) proc.off(signal, listener);
  };
}
