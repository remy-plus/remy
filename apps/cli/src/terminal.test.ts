import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  captureStray,
  createNotifier,
  gateSync,
  isFocusReport,
  notifySequence,
  parseFocus,
  parseProbeReply,
  probeTerminal,
} from './terminal.ts';
import { createTheme } from './theme.ts';

const BSU = '\x1b[?2026h';
const ESU = '\x1b[?2026l';

describe('parseProbeReply', () => {
  it('reads the DECRQM reply: set, reset or permanent means supported; 0 means not', () => {
    expect(parseProbeReply('\x1b[?2026;2$y\x1b[?62c')).toMatchObject({ sync: true, done: true });
    expect(parseProbeReply('\x1b[?2026;1$y').sync).toBe(true);
    expect(parseProbeReply('\x1b[?2026;0$y\x1b[?62c').sync).toBe(false);
    expect(parseProbeReply('\x1b[?62c')).toMatchObject({ sync: false, done: true });
    expect(parseProbeReply('\x1b[?2026;2$y').done).toBe(false);
  });
  it('reads light or dark from the OSC 11 colour', () => {
    expect(parseProbeReply('\x1b]11;rgb:0f0f/0f0f/1010\x07').background).toBe('dark');
    expect(parseProbeReply('\x1b]11;rgb:eded/ebeb/e6e6\x1b\\').background).toBe('light');
    expect(parseProbeReply('\x1b[?62c').background).toBeUndefined();
  });
});

describe('probeTerminal', () => {
  const tty = () =>
    Object.assign(new EventEmitter(), {
      isTTY: true,
      isRaw: false,
      setRawMode: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
    });
  it('asks nothing of a pipe or a dumb terminal', async () => {
    const out = { isTTY: true, write: vi.fn() };
    expect(await probeTerminal({ TERM: 'dumb' }, tty(), out)).toEqual({ sync: false });
    expect(await probeTerminal({ TERM: 'xterm' }, { ...tty(), isTTY: false }, out)).toEqual({
      sync: false,
    });
    expect(out.write).not.toHaveBeenCalled();
  });
  it('resolves on the DA1 reply and restores the terminal', async () => {
    const stdin = tty();
    const out = {
      isTTY: true,
      write: vi.fn((_: string) => {
        setImmediate(() =>
          stdin.emit('data', Buffer.from('\x1b[?2026;2$y\x1b]11;rgb:0000/0000/0000\x07\x1b[?64c')),
        );
      }),
    };
    const p = await probeTerminal({ TERM: 'xterm-256color' }, stdin, out);
    expect(p).toEqual({ sync: true, background: 'dark' });
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(out.write.mock.calls[0]?.[0]).toContain('\x1b[?2026$p');
  });
  it('does not ask for the background when colour is off', async () => {
    const stdin = tty();
    const out = {
      isTTY: true,
      write: vi.fn((_: string) => setImmediate(() => stdin.emit('data', '\x1b[?62c'))),
    };
    await probeTerminal({ TERM: 'xterm', NO_COLOR: '1' }, stdin, out);
    expect(out.write.mock.calls[0]?.[0]).not.toContain('\x1b]11');
  });
  it('gives up after the timeout when nothing answers', async () => {
    const t0 = Date.now();
    const p = await probeTerminal({ TERM: 'xterm' }, tty(), { isTTY: true, write: () => {} }, 30);
    expect(p).toEqual({ sync: false });
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('gateSync', () => {
  const sink = () => {
    const chunks: string[] = [];
    const stream = {
      isTTY: true,
      columns: 80,
      write: (c: string) => {
        chunks.push(c);
        return true;
      },
    };
    return { chunks, stream };
  };
  it('strips the markers when the terminal did not confirm support', () => {
    const { chunks, stream } = sink();
    const g = gateSync(stream, false);
    g.write(`${BSU}frame${ESU}`);
    expect(chunks).toEqual(['frame']);
    expect(g.columns).toBe(80);
    expect(g.isTTY).toBe(true);
  });
  it('passes everything through when it did', () => {
    const { chunks, stream } = sink();
    gateSync(stream, true).write(`${BSU}frame${ESU}`);
    expect(chunks).toEqual([`${BSU}frame${ESU}`]);
  });
});

describe('focus and notify', () => {
  it('parses focus reports, last one wins, and spots them as input', () => {
    expect(parseFocus('\x1b[O')).toBe(false);
    expect(parseFocus('\x1b[O\x1b[I')).toBe(true);
    expect(parseFocus('abc')).toBeUndefined();
    expect(isFocusReport('[I')).toBe(true);
    expect(isFocusReport('\x1b[O')).toBe(true);
    expect(isFocusReport('i')).toBe(false);
  });
  it('picks bell or OSC 9, and REMY_NOTIFY=off silences both', () => {
    expect(notifySequence({}, 'waiting_approval')).toBe('\x07');
    expect(notifySequence({ TERM_PROGRAM: 'iTerm.app' }, 'waiting_user')).toBe(
      '\x1b]9;Remy has a question\x07',
    );
    expect(notifySequence({ REMY_NOTIFY: 'off' }, 'waiting_approval')).toBe('');
  });
  it('rings only while the terminal says it is unfocused, and cleans up', () => {
    const stdin = Object.assign(new EventEmitter(), {
      isTTY: true,
      setRawMode() {},
      resume() {},
      pause() {},
    });
    const written: string[] = [];
    const out = { isTTY: true, write: (s: string) => written.push(s) };
    const n = createNotifier({ TERM: 'xterm' }, stdin, out);
    expect(written).toEqual(['\x1b[?1004h']);
    n.attention('waiting_approval'); // focus unknown: stays quiet
    stdin.emit('data', '\x1b[O');
    n.attention('waiting_approval');
    stdin.emit('data', '\x1b[I');
    n.attention('waiting_user');
    n.stop();
    expect(written).toEqual(['\x1b[?1004h', '\x07', '\x1b[?1004l']);
  });
  it('does nothing off a terminal or with REMY_NOTIFY=off', () => {
    const out = { isTTY: false, write: vi.fn() };
    const stdin = Object.assign(new EventEmitter(), { isTTY: false, resume() {}, pause() {} });
    createNotifier({ TERM: 'xterm' }, stdin, out).attention('waiting_user');
    createNotifier({ TERM: 'xterm', REMY_NOTIFY: 'off' }, stdin, out).stop();
    expect(out.write).not.toHaveBeenCalled();
  });
});

describe('captureStray', () => {
  it('routes console and stderr writes to the sink until restored', () => {
    const seen: string[] = [];
    const restore = captureStray((s, t) => seen.push(`${s}:${t}`));
    console.log('hello', { a: 1 });
    console.error('bad');
    process.stderr.write('oops');
    restore();
    expect(seen).toEqual(['stdout:hello {"a":1}', 'stderr:bad', 'stderr:oops']);
  });
});

describe('light theme', () => {
  it('darkens muted, accent and the diff roles on a light background', () => {
    const dark = createTheme('truecolor');
    const light = createTheme('truecolor', 'light');
    expect(light.color('muted')).not.toBe(dark.color('muted'));
    expect(light.color('error')).not.toBe(dark.color('error'));
    expect(dark.withBackground('light').color('accent')).toBe(light.color('accent'));
    expect(light.ramp(0, 6)).not.toBe(dark.ramp(0, 6));
  });
  it('NO_COLOR stays colourless whatever the background', () => {
    expect(createTheme('none', 'light').color('accent')).toBeUndefined();
    expect(createTheme('none', 'light').ramp(0, 6)).toBeUndefined();
  });
});
