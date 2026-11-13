// Voice on this machine only: whisper.cpp turns speech into text, ffmpeg records the microphone
// and macOS `say` speaks. Nothing is sent anywhere. Every program runs through `spawn` with an
// argument list, never a shell.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const MODEL_FILE = 'ggml-base.en.bin';
export const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`;
/** SHA-256 of the model, published by Hugging Face as the file's linked ETag. */
export const MODEL_SHA256 = 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002';
export const MAX_LISTEN_SECONDS = 30;
/** Most text spoken in one go; longer answers are cut at a sentence. */
export const MAX_SPOKEN_CHARS = 400;
const TRANSCRIBE_TIMEOUT_MS = 60_000;
const SAY_TIMEOUT_MS = 120_000;

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True when the program was stopped for taking too long. */
  timedOut?: boolean;
  /** Set when the program could not start (for example, it is not installed). */
  spawnError?: string;
}

export interface Running {
  /** Resolves when the program ends. */
  done: Promise<RunResult>;
  /** `quit` asks politely (writes `q` to stdin, which ffmpeg obeys); otherwise SIGTERM. */
  stop(quit?: boolean): void;
}

/** How programs are started. Tests pass a fake. */
export interface Exec {
  run(file: string, args: string[], o?: { timeoutMs?: number; input?: string }): Running;
}

export const realExec: Exec = {
  run(file, args, o = {}) {
    const child = spawn(file, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr = (stderr + String(d)).slice(-4000);
    });
    child.stdin.on('error', () => {});
    if (o.input !== undefined) child.stdin.end(o.input);
    const timer = o.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
        }, o.timeoutMs)
      : undefined;
    const done = new Promise<RunResult>((resolve) => {
      child.on('error', (e) => {
        if (timer) clearTimeout(timer);
        resolve({
          code: null,
          stdout,
          stderr,
          spawnError: (e as NodeJS.ErrnoException).code ?? e.message,
        });
      });
      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        resolve({ code, stdout, stderr, ...(timedOut && { timedOut }) });
      });
    });
    return {
      done,
      stop(quit) {
        if (quit) child.stdin.write('q', () => {});
        else child.kill('SIGTERM');
      },
    };
  },
};

export interface VoiceEnv {
  exec: Exec;
  /** Remy's home; the model lives in `<home>/voice`. */
  home: string;
  platform: NodeJS.Platform;
  exists(path: string): boolean;
  /** A private (0700) temp directory for a recording. */
  tempDir(): string;
  removeDir(path: string): void;
  fileSize(path: string): number;
  /** Where whisper-cli and ffmpeg are looked for, in order. */
  whisperBins: string[];
  ffmpegBins: string[];
}

export function realVoiceEnv(home = join(homedir(), '.remy')): VoiceEnv {
  return {
    exec: realExec,
    home,
    platform: process.platform,
    exists: existsSync,
    // mkdtemp creates the directory with mode 0700, so the recording inside is private.
    tempDir: () => mkdtempSync(join(tmpdir(), 'remy-voice-')),
    removeDir: (p) => rmSync(p, { recursive: true, force: true }),
    fileSize: (p) => statSync(p).size,
    whisperBins: ['whisper-cli', '/opt/homebrew/bin/whisper-cli', '/usr/local/bin/whisper-cli'],
    ffmpegBins: ['ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'],
  };
}

export type Part = 'whisper' | 'model' | 'ffmpeg' | 'say';

export interface PartStatus {
  part: Part;
  ok: boolean;
  /** One plain sentence: what is there, or the one next step. */
  message: string;
}

export const NEXT_STEP: Record<Part, string> = {
  whisper: 'Voice needs whisper.cpp: brew install whisper-cpp',
  model: `Voice needs the speech model: download ${MODEL_URL} into ~/.remy/voice/ (about 142 MB).`,
  ffmpeg: 'Voice needs ffmpeg to record: brew install ffmpeg',
  say: 'Spoken replies use the macOS say command, which this computer does not have.',
};

export type Outcome<T> = ({ ok: true } & T) | { ok: false; message: string };

/** Text for speaking: no code, links or markdown marks; at most `max` characters, cut at a sentence. */
export function spokenText(text: string, max = MAX_SPOKEN_CHARS): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^[#>\-*\s]+/gm, '')
    .replace(/[*_~|]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (plain.length <= max) return plain;
  const cut = plain.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  if (stop > max / 3) return cut.slice(0, stop + 1);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 0 ? space : max)}.`;
}

export interface ListenHandle {
  /** Ends the recording now and reads it. */
  stop(): void;
  /** Ends it and throws the audio away. */
  cancel(): void;
  result: Promise<Outcome<{ text: string }>>;
}

export function createVoice(env: VoiceEnv) {
  const modelPath = join(env.home, 'voice', MODEL_FILE);
  let speaking: Running | undefined;

  /** The first of `names` that starts at all (run with a harmless flag). */
  async function find(names: string[], flag: string): Promise<string | undefined> {
    for (const n of names) {
      const r = await env.exec.run(n, [flag], { timeoutMs: 10_000 }).done;
      if (!r.spawnError) return n;
    }
    return undefined;
  }

  async function check(): Promise<PartStatus[]> {
    const out: PartStatus[] = [];
    const w = await find(env.whisperBins, '--help');
    out.push({
      part: 'whisper',
      ok: Boolean(w),
      message: w ? `whisper.cpp found (${w})` : NEXT_STEP.whisper,
    });
    const has = env.exists(modelPath);
    out.push({
      part: 'model',
      ok: has,
      message: has ? `Speech model found (${modelPath})` : NEXT_STEP.model,
    });
    const f = await find(env.ffmpegBins, '-version');
    out.push({
      part: 'ffmpeg',
      ok: Boolean(f),
      message: f ? `ffmpeg found (${f})` : NEXT_STEP.ffmpeg,
    });
    if (env.platform === 'darwin') {
      const s = await env.exec.run('say', ['-v', '?'], { timeoutMs: 10_000 }).done;
      out.push({
        part: 'say',
        ok: !s.spawnError,
        message: s.spawnError ? NEXT_STEP.say : 'macOS say found',
      });
    } else out.push({ part: 'say', ok: false, message: NEXT_STEP.say });
    return out;
  }

  async function transcribe(wavPath: string): Promise<Outcome<{ text: string }>> {
    if (!env.exists(modelPath)) return { ok: false, message: NEXT_STEP.model };
    const bin = await find(env.whisperBins, '--help');
    if (!bin) return { ok: false, message: NEXT_STEP.whisper };
    if (!env.exists(wavPath)) return { ok: false, message: 'There is no recording to read.' };
    const r = await env.exec.run(
      bin,
      ['-m', modelPath, '-f', wavPath, '-l', 'en', '-nt', '-np', '-t', '4'],
      { timeoutMs: TRANSCRIBE_TIMEOUT_MS },
    ).done;
    if (r.timedOut)
      return {
        ok: false,
        message: 'Reading the recording took too long, so Remy stopped. Try a shorter one.',
      };
    if (r.spawnError) return { ok: false, message: NEXT_STEP.whisper };
    if (r.code !== 0)
      return { ok: false, message: 'whisper.cpp could not read the recording. Try again.' };
    const text = r.stdout
      .replace(/\[[A-Z_ ]+\]|\([a-z ]+\)/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text)
      return { ok: false, message: 'Remy heard nothing. Check the microphone and try again.' };
    return { ok: true, text };
  }

  /** Starts recording; the handle stops it. The wav lives in a private temp dir and is deleted. */
  function record(o: { maxSeconds?: number } = {}): ListenHandle | { ok: false; message: string } {
    const seconds = Math.min(Math.max(o.maxSeconds ?? MAX_LISTEN_SECONDS, 1), MAX_LISTEN_SECONDS);
    if (!env.exists(modelPath)) return { ok: false, message: NEXT_STEP.model };
    const dir = env.tempDir();
    const wav = join(dir, 'listen.wav');
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'avfoundation',
      '-i',
      ':0',
      '-t',
      String(seconds),
      '-ar',
      '16000',
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      wav,
    ];
    let running: Running | undefined;
    let cancelled = false;
    let stopped = false;
    const ready = (async () => {
      const bin = await find(env.ffmpegBins, '-version');
      if (!bin) return;
      running = env.exec.run(bin, args, { timeoutMs: (seconds + 10) * 1000 });
      if (stopped) running.stop(!cancelled);
    })();
    const result = (async (): Promise<Outcome<{ text: string }>> => {
      try {
        await ready;
        if (!running) return { ok: false, message: NEXT_STEP.ffmpeg };
        const r = await running.done;
        if (cancelled) return { ok: false, message: 'Stopped listening.' };
        if (r.spawnError) return { ok: false, message: NEXT_STEP.ffmpeg };
        if (!env.exists(wav) || env.fileSize(wav) < 1000) {
          const mic = /not permitted|permission|denied|Input\/output error/i.test(r.stderr);
          return {
            ok: false,
            message: mic
              ? 'Remy could not open the microphone. macOS asks Terminal for permission the first time: allow it in System Settings > Privacy & Security > Microphone, then try again.'
              : 'Remy could not record. Check that a microphone is connected and that Terminal may use it (System Settings > Privacy & Security > Microphone).',
          };
        }
        return await transcribe(wav);
      } finally {
        env.removeDir(dir);
      }
    })();
    return {
      stop() {
        stopped = true;
        running?.stop(true);
      },
      cancel() {
        cancelled = true;
        stopped = true;
        running?.stop(false);
      },
      result,
    };
  }

  /** Speaks the start of `text`. One voice at a time: a new call stops the last. */
  async function speak(text: string): Promise<Outcome<{ spoken: string }>> {
    if (env.platform !== 'darwin') return { ok: false, message: NEXT_STEP.say };
    const spoken = spokenText(text);
    if (!spoken) return { ok: false, message: 'There is nothing to say.' };
    stopSpeaking();
    // The text goes in on stdin, so a leading dash can never be read as an option.
    const run = env.exec.run('say', ['-f', '-'], { timeoutMs: SAY_TIMEOUT_MS, input: spoken });
    speaking = run;
    const r = await run.done;
    if (speaking === run) speaking = undefined;
    if (r.spawnError) return { ok: false, message: NEXT_STEP.say };
    return { ok: true, spoken };
  }

  function stopSpeaking(): boolean {
    if (!speaking) return false;
    speaking.stop(false);
    speaking = undefined;
    return true;
  }

  return {
    check,
    transcribe,
    record,
    speak,
    stopSpeaking,
    isSpeaking: () => speaking !== undefined,
    modelPath,
  };
}

export type Voice = ReturnType<typeof createVoice>;
