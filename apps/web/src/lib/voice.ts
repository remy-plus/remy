// Voice helpers: the browser's speech recognition and synthesis, the microphone's live level, and the
// small pieces that decide what is worth saying aloud. Everything is guarded: jsdom, older browsers and
// blocked permissions have none of these APIs, and each missing piece falls back in plain words.
import { useCallback, useEffect, useRef, useState } from 'react';

export const MSG_NO_MIC =
  "Remy can't hear you. Allow the microphone in your browser, then try again.";
export const MSG_NO_SPEECH = "This browser can't listen. You can still type.";
export const MSG_STOPPED = 'Listening stopped. You can still type.';
export const ON_SCREEN = 'I put the details on screen.';

/** How long a pause counts as "done talking". The words stay on screen the whole time. */
export const PAUSE_MS = 1800;
/** After a held key comes up, the words wait this long before they go. */
export const RELEASE_MS = 1200;

// ---- Speech recognition ----
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
export interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- Microphone level ----
interface AudioCtxLike {
  createMediaStreamSource(s: MediaStream): { connect(n: unknown): void };
  createAnalyser(): {
    fftSize: number;
    getByteTimeDomainData(a: Uint8Array): void;
  };
  close(): Promise<void>;
}

/** Smooths a raw 0..1 reading: quick to rise, slow to fall. */
export const smoothLevel = (prev: number, raw: number) =>
  raw > prev ? prev + (raw - prev) * 0.6 : prev * 0.85;

/** The loudness of one analyser frame, 0..1 (root mean square, lifted so speech fills the range). */
export const frameLevel = (data: Uint8Array): number => {
  let sum = 0;
  for (const v of data) {
    const d = (v - 128) / 128;
    sum += d * d;
  }
  return Math.min(1, Math.sqrt(sum / Math.max(1, data.length)) * 3);
};

export class MicDenied extends Error {}

/**
 * Opens the microphone and reports its smoothed level (0..1) about 20 times a second. Rejects with
 * `MicDenied` when the person or the browser says no. Resolves to a function that releases everything.
 * Without the audio APIs it resolves to a no-op: listening still works, only the level stays flat.
 */
export async function openMicLevel(onLevel: (level: number) => void): Promise<() => void> {
  const md = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const w =
    typeof window === 'undefined' ? undefined : (window as unknown as Record<string, unknown>);
  const Ctx = (w?.AudioContext ?? w?.webkitAudioContext) as (new () => AudioCtxLike) | undefined;
  if (!md || typeof md.getUserMedia !== 'function' || !Ctx) return () => {};
  let stream: MediaStream;
  try {
    stream = await md.getUserMedia({ audio: true });
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
      throw new MicDenied(MSG_NO_MIC);
    return () => {}; // no device or busy: the recogniser may still work
  }
  let ctx: AudioCtxLike | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  const release = () => {
    clearInterval(timer);
    for (const t of stream.getTracks()) t.stop();
    ctx?.close().catch(() => {});
    ctx = null;
    onLevel(0);
  };
  try {
    ctx = new Ctx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let level = 0;
    const still = reducedMotion();
    timer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      level = smoothLevel(level, frameLevel(data));
      onLevel(still ? 0 : Math.round(level * 100) / 100);
    }, 50);
  } catch {
    // no analyser: keep the stream until released, show a flat level
  }
  return release;
}

// ---- What is worth saying aloud ----
const LIST_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/;

/** Plain text of a markdown fragment: no links, markers or backticks. */
const plain = (s: string) =>
  s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]{1,3}([^*_~\n]+)[*_~]{1,3}/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim();

/** Splits text at sentence ends into pieces no longer than `max`, so speech starts at once. */
export const chunkText = (text: string, max = 180): string[] => {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) out.push(cur.trim());
    cur = '';
  };
  for (const s of sentences) {
    if (cur && cur.length + s.length > max) push();
    if (s.length > max) {
      for (const w of s.split(/\s+/)) {
        if (cur && cur.length + w.length + 1 > max) push();
        cur += `${cur ? ' ' : ''}${w}`;
      }
    } else cur += s;
  }
  push();
  return out;
};

const SPOKEN_MAX = 420;

/**
 * What to say for a final answer, in short chunks. Code blocks and long lists stay on screen, and a
 * long answer is cut at a sentence; in each case the last chunk points to the screen.
 */
export function speakable(answer: string): string[] {
  let onScreen = false;
  let text = answer.replace(/```[\s\S]*?(?:```|$)/g, () => {
    onScreen = true;
    return '\n';
  });
  const lines = text.split('\n');
  if (lines.filter((l) => LIST_LINE.test(l)).length >= 4) {
    onScreen = true;
    text = lines.filter((l) => !LIST_LINE.test(l)).join('\n');
  }
  let spoken = plain(text.replace(/([^.!?:;,\s])\s*\n{2,}/g, '$1. ').replace(/\n/g, ' '));
  if (spoken.length > SPOKEN_MAX) {
    onScreen = true;
    const cut = spoken.slice(0, SPOKEN_MAX);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
    spoken = end > 40 ? cut.slice(0, end + 1) : cut;
  }
  const chunks = chunkText(spoken);
  if (onScreen) chunks.push(ON_SCREEN);
  return chunks;
}

// ---- Speaking ----
// Remy's own voice comes from the server (POST /api/voice/speak, Fish Audio): one short piece of text in,
// one audio file out, so the key never reaches the browser. Chunks play in order, the next one is fetched
// while the current one plays. With no voice key (503), no credit (402), a network error or a browser that
// blocks audio, the rest of the reply is read by the browser's own voice instead.

/** Fetches audio for one piece of text. Rejects when the server cannot make it. */
export type AudioSource = (text: string, signal: AbortSignal) => Promise<Blob>;

let source: AudioSource | null = null;
/** After the server says it has no voice (no key, no credit), it is not asked again for this long. */
export const VOICE_BACKOFF_MS = 60_000;
let silentUntil = 0;
/** After the browser blocks autoplay, the server voice is not asked again until a press unlocks audio. */
let blockedUntil = 0;

/** Where Remy's voice comes from (the connected server), or null for the browser's voice only. */
export const bindVoiceSource = (s: AudioSource | null) => {
  source = s;
  silentUntil = 0;
  blockedUntil = 0;
};

// A tiny silent WAV (one sample): playing it from a button press tells the browser audio is welcome.
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAESsAABErAAABAAgAZGF0YQIAAACAgA==';

/**
 * Call from a click or key press (the speaker button, the mic): plays a silent sound so the browser
 * lets Remy's voice play later, when the reply arrives without a press. Never throws.
 */
export const unlockAudio = () => {
  if (typeof Audio === 'undefined') return;
  try {
    const a = new Audio(SILENT_WAV);
    a.volume = 0;
    void a
      .play()
      .then(() => {
        blockedUntil = 0;
      })
      .catch(() => {});
  } catch {
    // no audio here; nothing to unlock
  }
};

const browserVoice = () =>
  typeof window !== 'undefined' &&
  'speechSynthesis' in window &&
  typeof SpeechSynthesisUtterance !== 'undefined';

export const canSpeak = () => source !== null || browserVoice();

/** The small part of an audio element the player uses. */
export interface PlayerLike {
  play(): Promise<void>;
  pause(): void;
  onended: ((e: Event) => void) | null;
  onerror: ((e: Event | string) => void) | null;
}

/** What `speakWith` needs from the page. The defaults are the real ones; tests pass fakes. */
export interface SpeakEnv {
  /** Audio for a piece of text; undefined when there is no server voice. */
  fetchAudio?: AudioSource | undefined;
  makeUrl?(blob: Blob): string;
  revokeUrl?(url: string): void;
  makePlayer?(url: string): PlayerLike;
  /** The browser refused to start audio (autoplay blocked). */
  onBlocked?(): void;
  /** The browser's voice; undefined when it has none. */
  synth?: SpeechSynthesis | undefined;
  lang?: string;
}

const realEnv = (): SpeakEnv => {
  const fetchAudio: AudioSource | undefined = source
    ? (text, signal) => {
        if (Date.now() < Math.max(silentUntil, blockedUntil))
          return Promise.reject(new Error('voice is off for now'));
        return (source as AudioSource)(text, signal).catch((e: unknown) => {
          const status = (e as { status?: number } | null)?.status;
          if (status === 503 || status === 402) silentUntil = Date.now() + VOICE_BACKOFF_MS;
          throw e;
        });
      }
    : undefined;
  return {
    fetchAudio,
    makeUrl: (b) => URL.createObjectURL(b),
    revokeUrl: (u) => URL.revokeObjectURL(u),
    makePlayer: (url) => new Audio(url),
    onBlocked: () => {
      blockedUntil = Date.now() + VOICE_BACKOFF_MS;
    },
    synth: browserVoice() ? window.speechSynthesis : undefined,
    lang: typeof navigator === 'undefined' ? 'en-GB' : navigator.language || 'en-GB',
  };
};

/**
 * Speaks `chunks` in order and returns a function that stops it. `onDone` fires once, when they end or
 * are cancelled. With no server voice (or when it fails) the browser's voice takes over from the chunk
 * that could not be played.
 */
export function speakWith(env: SpeakEnv, chunks: string[], onDone: () => void): () => void {
  const { fetchAudio, synth } = env;
  if (chunks.length === 0 || (!fetchAudio && !synth)) {
    onDone();
    return () => {};
  }
  let stopped = false;
  let finished = false;
  let browserSpeaking = false;
  let gaveUp = false; // the server voice is done with: nothing new is kept, nothing more is asked
  const release = (u: string) => {
    if (urls.delete(u)) env.revokeUrl?.(u);
  };
  let stopPlayer: (() => void) | null = null;
  const abort = new AbortController();
  const urls = new Set<string>();
  const finish = () => {
    if (finished) return;
    finished = true;
    for (const u of urls) env.revokeUrl?.(u);
    urls.clear();
    onDone();
  };

  /** The browser's voice reads chunks `from` to the end. */
  const speakInBrowser = (from: number) => {
    gaveUp = true;
    abort.abort(); // the request for the next chunk is no longer wanted
    for (const u of [...urls]) release(u);
    if (!synth) return finish();
    browserSpeaking = true;
    synth.cancel();
    let left = chunks.length - from;
    for (const c of chunks.slice(from)) {
      const u = new SpeechSynthesisUtterance(c);
      u.lang = env.lang ?? 'en-GB';
      u.onend = () => {
        left -= 1;
        if (left <= 0) finish();
      };
      u.onerror = finish;
      synth.speak(u);
    }
  };

  // One request per chunk, each started when the one before it has arrived.
  const audio: Promise<string | null>[] = [];
  const fetchChunk = (i: number): Promise<string | null> => {
    if (i >= chunks.length || !fetchAudio) return Promise.resolve(null);
    audio[i] ??= fetchAudio(chunks[i] as string, abort.signal).then(
      (blob) => {
        if (stopped || gaveUp || finished) return null;
        const url = env.makeUrl?.(blob) ?? null;
        if (url) urls.add(url);
        return url;
      },
      () => null,
    );
    return audio[i] as Promise<string | null>;
  };

  /** Plays one file to its end. Resolves false when it cannot (blocked, broken) or when stopped. */
  const play = (url: string) =>
    new Promise<boolean>((resolve) => {
      let player: PlayerLike;
      try {
        player = (env.makePlayer as (u: string) => PlayerLike)(url);
      } catch {
        return resolve(false);
      }
      const end = (ok: boolean) => {
        stopPlayer = null;
        player.onended = player.onerror = null;
        resolve(ok);
      };
      stopPlayer = () => {
        try {
          player.pause();
        } catch {
          // already stopped
        }
        end(false);
      };
      player.onended = () => end(true);
      player.onerror = () => end(false);
      try {
        player.play().catch((e: unknown) => {
          // autoplay blocked or no decoder
          if ((e as { name?: string } | null)?.name === 'NotAllowedError') env.onBlocked?.();
          end(false);
        });
      } catch {
        end(false);
      }
    });

  void (async () => {
    if (!fetchAudio || !env.makePlayer) return speakInBrowser(0);
    let pending = fetchChunk(0);
    for (let i = 0; i < chunks.length; i++) {
      const url = await pending;
      if (stopped) return;
      if (!url) return speakInBrowser(i);
      pending = fetchChunk(i + 1); // the next one arrives while this one plays
      const played = await play(url);
      release(url); // this chunk is done: free its audio now, not at the end
      if (stopped) return;
      if (!played) return speakInBrowser(i);
    }
    finish();
  })();

  return () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    stopPlayer?.();
    if (browserSpeaking) {
      try {
        synth?.cancel();
      } catch {
        // nothing to cancel
      }
    }
    finish();
  };
}

/** Speaks `chunks` one after another. `onDone` fires once, when they end or are cancelled. */
export const speakChunks = (chunks: string[], onDone: () => void): (() => void) =>
  speakWith(realEnv(), chunks, onDone);

// ---- Claiming the talk button ----
// The full-screen talk window (PushToTalk) handles `remy:voice` and held Space only while no composer
// is on screen; with a composer, the words go straight into it.
export interface VoiceClaim {
  toggle(): void;
  begin(): void;
  /** The held key came up: stop listening and let the words go after a pause. */
  release(): void;
}
let claim: VoiceClaim | null = null;
export const claimVoice = (c: VoiceClaim) => {
  claim = c;
  return () => {
    if (claim === c) claim = null;
  };
};
export const voiceClaim = () => claim;

// ---- The listening hook ----
export interface ListenerOptions {
  /** The text already in the box when listening starts, and where the words go. */
  getValue: () => string;
  setValue: (v: string) => void;
  /** Called when the person has paused after speaking and the words have been on screen. */
  onPause: () => void;
  onStart?: () => void;
}

export function useListener(opts: ListenerOptions) {
  const o = useRef(opts);
  o.current = opts;
  const rec = useRef<Recognition | null>(null);
  const release = useRef<(() => void) | null>(null);
  const token = useRef(0);
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dictated = useRef(false);
  const [listening, setListening] = useState(false);
  const [level, setLevel] = useState(0);
  const [interim, setInterim] = useState('');
  const [problem, setProblem] = useState('');
  const [announce, setAnnounce] = useState('');
  const supported = recognitionCtor() !== null;

  const cancelPause = useCallback(() => {
    clearTimeout(pause.current);
    pause.current = undefined;
    dictated.current = false;
  }, []);

  const teardown = useCallback(() => {
    token.current += 1;
    const r = rec.current;
    rec.current = null;
    if (r) {
      r.onresult = r.onerror = r.onend = null;
      try {
        r.abort();
      } catch {
        // already stopped
      }
    }
    release.current?.();
    release.current = null;
    setLevel(0);
    setInterim('');
  }, []);

  /** Stops listening. With `send`, spoken words go after a short pause unless they are edited. */
  const stop = useCallback(
    (send = false) => {
      const was = rec.current !== null || release.current !== null;
      teardown();
      clearTimeout(pause.current);
      pause.current = undefined;
      if (send && dictated.current) {
        pause.current = setTimeout(() => {
          pause.current = undefined;
          dictated.current = false;
          o.current.onPause();
        }, RELEASE_MS);
      } else dictated.current = false;
      setListening(false);
      if (was) setAnnounce('Stopped listening');
    },
    [teardown],
  );

  const start = useCallback(async () => {
    if (rec.current || release.current) return;
    const Ctor = recognitionCtor();
    setProblem('');
    if (!Ctor) {
      setProblem(MSG_NO_SPEECH);
      return;
    }
    cancelPause();
    unlockAudio(); // a press is the moment the browser lets audio start
    o.current.onStart?.();
    const mine = ++token.current;
    setListening(true);
    setAnnounce('Listening');
    let off: () => void;
    try {
      let last = 0;
      off = await openMicLevel((l) => {
        if (token.current === mine && (Math.abs(l - last) >= 0.02 || l === 0)) {
          last = l;
          setLevel(l);
        }
      });
    } catch (e) {
      if (token.current === mine) {
        teardown();
        setListening(false);
        setAnnounce('');
        setProblem(e instanceof MicDenied ? MSG_NO_MIC : MSG_STOPPED);
      }
      return;
    }
    if (token.current !== mine) {
      off(); // stopped while the browser was asking
      return;
    }
    release.current = off;
    const base = o.current.getValue();
    const arm = () => {
      clearTimeout(pause.current);
      pause.current = setTimeout(() => {
        pause.current = undefined;
        if (!dictated.current) return;
        stop();
        o.current.onPause();
      }, PAUSE_MS);
    };
    try {
      const r = new Ctor();
      r.continuous = true;
      r.interimResults = true;
      r.lang = navigator.language || 'en-GB';
      r.onresult = (e) => {
        let done = '';
        let part = '';
        for (let i = 0; i < e.results.length; i++) {
          const item = e.results[i];
          if (!item) continue;
          if (item.isFinal) done += item[0].transcript;
          else part += item[0].transcript;
        }
        const heard = done.trim();
        if (heard) {
          dictated.current = true;
          o.current.setValue(`${base}${base && !/\s$/.test(base) ? ' ' : ''}${heard}`);
        }
        setInterim(part.trim());
        if (dictated.current && !part.trim()) arm();
        else clearTimeout(pause.current);
      };
      r.onerror = (e) => {
        const denied = e.error === 'not-allowed' || e.error === 'service-not-allowed';
        stop();
        if (denied) setProblem(MSG_NO_MIC);
        else if (e.error !== 'no-speech' && e.error !== 'aborted') setProblem(MSG_STOPPED);
      };
      r.onend = () => stop(true);
      rec.current = r;
      r.start();
    } catch {
      stop();
      setProblem(MSG_STOPPED);
    }
  }, [cancelPause, stop, teardown]);

  const toggle = useCallback(() => {
    if (rec.current || release.current) stop();
    else void start();
  }, [start, stop]);

  // Escape stops listening and keeps the words in the box.
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listening, stop]);

  // Leaving the page releases the microphone and any waiting send.
  useEffect(
    () => () => {
      teardown();
      clearTimeout(pause.current);
    },
    [teardown],
  );

  return {
    listening,
    level,
    interim,
    problem,
    announce,
    supported,
    start,
    stop,
    toggle,
    /** Typing or editing means the person is still working on the words: nothing goes by itself. */
    edited: cancelPause,
  };
}
