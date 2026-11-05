import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { onStopSignals } from './signals.ts';

const proc = () => {
  const p = new EventEmitter() as EventEmitter & { exit: (code: number) => void };
  p.exit = vi.fn();
  return p;
};

describe('onStopSignals', () => {
  it.each([
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ])('runs the handler once on %s and then exits', async (signal, code) => {
    const p = proc();
    const handler = vi.fn(async () => {});
    onStopSignals(p, handler);
    p.emit(signal);
    p.emit(signal);
    await vi.waitFor(() => expect(p.exit).toHaveBeenCalledWith(code));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(p.exit).toHaveBeenCalledTimes(1);
  });

  it('exits even when the handler fails', async () => {
    const p = proc();
    onStopSignals(p, async () => {
      throw new Error('no');
    });
    p.emit('SIGTERM');
    await vi.waitFor(() => expect(p.exit).toHaveBeenCalledWith(143));
  });

  it('stops listening when turned off', () => {
    const p = proc();
    onStopSignals(p, async () => {})();
    expect(p.listenerCount('SIGINT') + p.listenerCount('SIGTERM')).toBe(0);
  });
});
