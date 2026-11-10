import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AudioSource,
  bindVoiceSource,
  canSpeak,
  chunkText,
  frameLevel,
  ON_SCREEN,
  type PlayerLike,
  type SpeakEnv,
  smoothLevel,
  speakable,
  speakChunks,
  speakWith,
  unlockAudio,
} from './voice.ts';

describe('speakable', () => {
  it('speaks a short answer in plain words', () => {
    expect(speakable('I **booked** the [table](https://x.test) for 7pm.')).toEqual([
      'I booked the table for 7pm.',
    ]);
  });
  it('leaves code on screen and says so', () => {
    const out = speakable('Here is the fix.\n```ts\nconst a = 1;\n```\nRun it again.');
    expect(out.join(' ')).not.toContain('const');
    expect(out.at(-1)).toBe(ON_SCREEN);
  });
  it('leaves a long list on screen', () => {
    const out = speakable('Found these:\n- a\n- b\n- c\n- d\n- e');
    expect(out).toEqual(['Found these:', ON_SCREEN]);
  });
  it('cuts a long answer at a sentence', () => {
    const out = speakable('One sentence here. '.repeat(60));
    expect(out.at(-1)).toBe(ON_SCREEN);
    expect(out.every((c) => c.length <= 180)).toBe(true);
  });
});

describe('levels', () => {
  it('chunks at sentence ends', () => {
    expect(chunkText('First one. Second one.', 12)).toEqual(['First one.', 'Second one.']);
  });
  it('reads silence as 0 and a loud wave as high', () => {
    expect(frameLevel(new Uint8Array(64).fill(128))).toBe(0);
    expect(frameLevel(Uint8Array.from({ length: 64 }, (_, i) => (i % 2 ? 255 : 0)))).toBe(1);
  });
  it('rises fast and falls slowly', () => {
    expect(smoothLevel(0, 1)).toBeCloseTo(0.6);
    expect(smoothLevel(1, 0)).toBeCloseTo(0.85);
  });
});

afterEach(() => vi.unstubAllGlobals());

// ---- Remy's voice: chunks fetched from the server, played in order, browser voice as the fallback ----
class FakePlayer implements PlayerLike {
  onended: ((e: Event) => void) | null = null;
  onerror: ((e: Event | string) => void) | null = null;
  paused = false;
  readonly url: string;
  private readonly log: string[];
  private readonly blocked: boolean;
  constructor(url: string, log: string[], blocked: boolean) {
    this.url = url;
    this.log = log;
    this.blocked = blocked;
  }
  play() {
    this.log.push(`play ${this.url}`);
    return this.blocked
      ? Promise.reject(new DOMException('blocked', 'NotAllowedError'))
      : Promise.resolve();
  }
  pause() {
    this.paused = true;
    this.log.push(`pause ${this.url}`);
  }
  end() {
    this.onended?.(new Event('ended'));
  }
}

interface Rig {
  env: SpeakEnv;
  log: string[];
  players: FakePlayer[];
  requested: string[];
  aborted: () => boolean;
  /** Settles the request for `text`. */
  answer(text: string, ok?: boolean): void;
  spoken: string[];
  synthCancels: () => number;
}

function rig(o: { fetch?: boolean; blocked?: boolean; synth?: boolean } = {}): Rig {
  const log: string[] = [];
  const players: FakePlayer[] = [];
  const requested: string[] = [];
  const waiting = new Map<string, { ok(): void; fail(): void }>();
  const spoken: string[] = [];
  let cancels = 0;
  let signal: AbortSignal | undefined;
  const fetchAudio: AudioSource = (text, sig) => {
    signal = sig;
    requested.push(text);
    return new Promise<Blob>((resolve, reject) => {
      waiting.set(text, {
        ok: () => resolve(new Blob([text])),
        fail: () => reject(new Error('no')),
      });
    });
  };
  class Utterance {
    lang = '';
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readonly text: string;
    constructor(text: string) {
      this.text = text;
    }
  }
  vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
  const synth = {
    cancel: () => {
      cancels += 1;
    },
    speak: (u: Utterance) => {
      spoken.push(u.text);
      queueMicrotask(() => u.onend?.());
    },
  } as unknown as SpeechSynthesis;
  let n = 0;
  return {
    env: {
      fetchAudio: o.fetch === false ? undefined : fetchAudio,
      makeUrl: (b) => {
        const u = `blob:${(b as Blob & { _t?: string })._t ?? ++n}`;
        log.push(`make ${u}`);
        return u;
      },
      revokeUrl: (u) => log.push(`revoke ${u}`),
      makePlayer: (url) => {
        const p = new FakePlayer(url, log, o.blocked === true);
        players.push(p);
        return p;
      },
      synth: o.synth === false ? undefined : synth,
      lang: 'en-GB',
    },
    log,
    players,
    requested,
    aborted: () => signal?.aborted === true,
    answer: (text, ok = true) => (ok ? waiting.get(text)?.ok() : waiting.get(text)?.fail()),
    spoken,
    synthCancels: () => cancels,
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('speaking with the server voice', () => {
  it('plays chunks in order and fetches the next one while one plays', async () => {
    const r = rig();
    const done = vi.fn();
    speakWith(r.env, ['One.', 'Two.', 'Three.'], done);
    expect(r.requested).toEqual(['One.']);
    // The second chunk arrives first; nothing plays out of order.
    r.answer('One.');
    await tick();
    expect(r.requested).toEqual(['One.', 'Two.']); // the next is fetched while the first plays
    expect(r.players).toHaveLength(1);
    r.answer('Two.');
    await tick();
    expect(r.players).toHaveLength(1); // still the first
    r.players[0]?.end();
    await tick();
    expect(r.players).toHaveLength(2);
    expect(r.requested).toEqual(['One.', 'Two.', 'Three.']);
    r.players[1]?.end();
    await tick();
    r.answer('Three.');
    await tick();
    expect(r.players).toHaveLength(3);
    expect(done).not.toHaveBeenCalled();
    r.players[2]?.end();
    await tick();
    expect(done).toHaveBeenCalledTimes(1);
    expect(r.spoken).toEqual([]); // the browser voice was never used
    // every object URL is released
    expect(r.log.filter((l) => l.startsWith('revoke'))).toHaveLength(3);
  });

  it('stops at once on cancel: pauses audio, aborts the request, ends once', async () => {
    const r = rig();
    const done = vi.fn();
    const stop = speakWith(r.env, ['One.', 'Two.'], done);
    r.answer('One.');
    await tick();
    stop();
    expect(r.players[0]?.paused).toBe(true);
    expect(r.aborted()).toBe(true);
    expect(done).toHaveBeenCalledTimes(1);
    r.answer('Two.'); // a late answer plays nothing
    await tick();
    expect(r.players).toHaveLength(1);
    expect(r.spoken).toEqual([]);
    stop();
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('cancelling before the first chunk arrives plays nothing', async () => {
    const r = rig();
    const done = vi.fn();
    const stop = speakWith(r.env, ['One.'], done);
    stop();
    r.answer('One.');
    await tick();
    expect(r.players).toHaveLength(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('falls back to the browser voice for the whole reply when the server has no voice', async () => {
    const r = rig();
    const done = vi.fn();
    speakWith(r.env, ['One.', 'Two.'], done);
    r.answer('One.', false); // 503: no key
    await tick();
    await tick();
    expect(r.spoken).toEqual(['One.', 'Two.']);
    expect(r.players).toHaveLength(0);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('falls back from the chunk that failed, keeping the ones already spoken', async () => {
    const r = rig();
    const done = vi.fn();
    speakWith(r.env, ['One.', 'Two.', 'Three.'], done);
    r.answer('One.');
    await tick();
    r.answer('Two.', false); // network error on the prefetch
    r.players[0]?.end();
    await tick();
    await tick();
    expect(r.spoken).toEqual(['Two.', 'Three.']);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('falls back when the browser blocks the audio', async () => {
    const r = rig({ blocked: true });
    const done = vi.fn();
    speakWith(r.env, ['One.', 'Two.'], done);
    r.answer('One.');
    await tick();
    await tick();
    expect(r.spoken).toEqual(['One.', 'Two.']);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('cancelling during the browser fallback stops the browser voice', async () => {
    const r = rig();
    const done = vi.fn();
    const stop = speakWith(r.env, ['One.'], done);
    r.answer('One.', false);
    await tick();
    const before = r.synthCancels();
    stop();
    expect(r.synthCancels()).toBe(before + 1);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('with no server voice uses the browser voice, and with neither it just finishes', () => {
    const a = rig({ fetch: false });
    const doneA = vi.fn();
    speakWith(a.env, ['One.'], doneA);
    expect(a.spoken).toEqual(['One.']);
    const b = rig({ fetch: false, synth: false });
    const doneB = vi.fn();
    speakWith(b.env, ['One.'], doneB);
    expect(doneB).toHaveBeenCalledTimes(1);
    const c = rig();
    const doneC = vi.fn();
    speakWith(c.env, [], doneC);
    expect(doneC).toHaveBeenCalledTimes(1);
    expect(c.requested).toEqual([]);
  });

  it('with a server voice but no browser voice, a failure ends quietly', async () => {
    const r = rig({ synth: false });
    const done = vi.fn();
    speakWith(r.env, ['One.'], done);
    r.answer('One.', false);
    await tick();
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe('cleanup and autoplay', () => {
  it('revokes each chunk URL as soon as that chunk finishes', async () => {
    const r = rig();
    speakWith(r.env, ['One.', 'Two.'], vi.fn());
    r.answer('One.');
    await tick();
    r.answer('Two.');
    r.players[0]?.end();
    await tick();
    expect(r.log.filter((l) => l.startsWith('revoke'))).toHaveLength(1); // chunk one, mid-reply
  });

  it('when playing fails, aborts the next request and revokes a URL that arrives late', async () => {
    const r = rig({ blocked: true });
    const done = vi.fn();
    speakWith(r.env, ['One.', 'Two.'], done);
    r.answer('One.');
    await tick();
    await tick();
    expect(r.aborted()).toBe(true); // the request for chunk two was aborted
    r.answer('Two.'); // it still answers: the object URL must not be made, let alone leaked
    await tick();
    await tick();
    // every object URL that was made has been revoked: none leaks
    expect(r.log.filter((l) => l.startsWith('make'))).toHaveLength(
      r.log.filter((l) => l.startsWith('revoke')).length,
    );
    expect(r.log.filter((l) => l.startsWith('make'))).toHaveLength(1);
    expect(r.spoken).toEqual(['One.', 'Two.']);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('reports NotAllowedError to the page so it can back off', async () => {
    const r = rig({ blocked: true });
    const onBlocked = vi.fn();
    speakWith({ ...r.env, onBlocked }, ['One.'], vi.fn());
    r.answer('One.');
    await tick();
    await tick();
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });

  it('a blocked autoplay turns the server voice off for a while; unlockAudio is safe to call', async () => {
    const calls: string[] = [];
    bindVoiceSource(async (text) => {
      calls.push(text);
      return new Blob([text]);
    });
    vi.stubGlobal(
      'Audio',
      class {
        volume = 1;
        onended: (() => void) | null = null;
        onerror: (() => void) | null = null;
        play() {
          return Promise.reject(new DOMException('blocked', 'NotAllowedError'));
        }
        pause() {}
      },
    );
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
    speakChunks(['One.'], vi.fn());
    await tick();
    await tick();
    speakChunks(['Two.'], vi.fn());
    await tick();
    expect(calls).toEqual(['One.']); // not asked again
    expect(() => unlockAudio()).not.toThrow();
    bindVoiceSource(null);
    vi.unstubAllGlobals();
  });
});

describe('the bound voice source', () => {
  it('is used through speakChunks, and a 503 turns it off for a while', async () => {
    const calls: string[] = [];
    bindVoiceSource(async (text) => {
      calls.push(text);
      throw Object.assign(new Error('no key'), { status: 503 });
    });
    expect(canSpeak()).toBe(true);
    const done1 = vi.fn();
    speakChunks(['One.'], done1);
    await tick();
    await tick();
    expect(calls).toEqual(['One.']);
    // asked again within the backoff: the server is not called
    speakChunks(['Two.'], vi.fn());
    await tick();
    expect(calls).toEqual(['One.']);
    bindVoiceSource(null);
  });
});
