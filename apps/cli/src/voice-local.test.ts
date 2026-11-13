import { describe, expect, it } from 'vitest';
import {
  createVoice,
  type Exec,
  MAX_SPOKEN_CHARS,
  NEXT_STEP,
  type Running,
  type RunResult,
  spokenText,
  type VoiceEnv,
} from './voice-local.ts';

interface Call {
  file: string;
  args: string[];
  input?: string;
  timeoutMs?: number;
}

function fake(
  handler: (c: Call) => Partial<RunResult> | 'hang',
  opts: { files?: string[]; sizes?: Record<string, number> } = {},
) {
  const calls: Call[] = [];
  const stops: { file: string; quit?: boolean }[] = [];
  const removed: string[] = [];
  const files = new Set(opts.files ?? ['/h/voice/ggml-base.en.bin']);
  const exec: Exec = {
    run(file, args, o) {
      const c: Call = { file, args, ...o };
      calls.push(c);
      const r = handler(c);
      let finish: (r: RunResult) => void = () => {};
      const done = new Promise<RunResult>((res) => {
        finish = res;
        if (r !== 'hang') res({ code: 0, stdout: '', stderr: '', ...r });
      });
      const running: Running = {
        done,
        stop(quit) {
          stops.push({ file, quit });
          // A recording writes its file when asked to end.
          if (file.includes('ffmpeg') && c.args.at(-1)) files.add(c.args.at(-1) as string);
          finish({ code: quit ? 0 : null, stdout: '', stderr: '' });
        },
      };
      return running;
    },
  };
  const env: VoiceEnv = {
    exec,
    home: '/h',
    platform: 'darwin',
    exists: (p) => files.has(p),
    tempDir: () => '/tmp/rv',
    removeDir: (p) => void removed.push(p),
    fileSize: (p) => opts.sizes?.[p] ?? 50_000,
    whisperBins: ['whisper-cli'],
    ffmpegBins: ['ffmpeg'],
  };
  return { env, calls, stops, removed, files };
}

const missing = (file: string) => (c: Call) =>
  c.file === file ? { code: null, spawnError: 'ENOENT' } : {};

describe('check', () => {
  it('names the one next step for each missing part', async () => {
    const f = fake(() => ({ code: null, spawnError: 'ENOENT' }), { files: [] });
    const s = await createVoice(f.env).check();
    expect(s.every((p) => !p.ok)).toBe(true);
    expect(s.find((p) => p.part === 'whisper')?.message).toBe(
      'Voice needs whisper.cpp: brew install whisper-cpp',
    );
    expect(s.find((p) => p.part === 'ffmpeg')?.message).toBe(NEXT_STEP.ffmpeg);
    expect(s.find((p) => p.part === 'model')?.message).toContain('~/.remy/voice/');
  });

  it('is all ok when everything is there', async () => {
    const f = fake(() => ({}));
    expect((await createVoice(f.env).check()).every((p) => p.ok)).toBe(true);
  });
});

describe('transcribe', () => {
  it('runs whisper-cli with an argument list and reads the text', async () => {
    const f = fake(
      (c) => (c.args.includes('-m') ? { stdout: ' Remind me to call the dentist. \n' } : {}),
      {
        files: ['/h/voice/ggml-base.en.bin', '/w/a.wav'],
      },
    );
    const r = await createVoice(f.env).transcribe('/w/a.wav');
    expect(r).toEqual({ ok: true, text: 'Remind me to call the dentist.' });
    const run = f.calls.find((c) => c.args.includes('-m'));
    expect(run?.args).toContain('/w/a.wav');
    expect(run?.timeoutMs).toBeGreaterThan(0);
  });

  it('says what to install when whisper is missing', async () => {
    const f = fake(missing('whisper-cli'), { files: ['/h/voice/ggml-base.en.bin', '/w/a.wav'] });
    expect(await createVoice(f.env).transcribe('/w/a.wav')).toEqual({
      ok: false,
      message: NEXT_STEP.whisper,
    });
  });

  it('says what to download when the model is missing', async () => {
    const f = fake(() => ({}), { files: ['/w/a.wav'] });
    const r = await createVoice(f.env).transcribe('/w/a.wav');
    expect(r).toEqual({ ok: false, message: NEXT_STEP.model });
    expect(f.calls).toHaveLength(0);
  });

  it('reports a timeout plainly', async () => {
    const f = fake((c) => (c.args.includes('-m') ? { code: null, timedOut: true } : {}), {
      files: ['/h/voice/ggml-base.en.bin', '/w/a.wav'],
    });
    const r = await createVoice(f.env).transcribe('/w/a.wav');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('too long');
  });

  it('treats a blank or noise-only transcript as nothing heard', async () => {
    const f = fake((c) => (c.args.includes('-m') ? { stdout: ' [BLANK_AUDIO] \n' } : {}), {
      files: ['/h/voice/ggml-base.en.bin', '/w/a.wav'],
    });
    const r = await createVoice(f.env).transcribe('/w/a.wav');
    expect(!r.ok && r.message).toContain('heard nothing');
  });

  it('fails plainly on a non-zero exit', async () => {
    const f = fake((c) => (c.args.includes('-m') ? { code: 2 } : {}), {
      files: ['/h/voice/ggml-base.en.bin', '/w/a.wav'],
    });
    expect((await createVoice(f.env).transcribe('/w/a.wav')).ok).toBe(false);
  });
});

describe('record', () => {
  it('records 16 kHz mono through ffmpeg, stops on request, reads it and deletes the folder', async () => {
    const f = fake((c) =>
      c.file === 'whisper-cli' && c.args.includes('-m')
        ? { stdout: 'call the dentist' }
        : c.file === 'ffmpeg' && c.args.includes('avfoundation')
          ? 'hang'
          : {},
    );
    const h = createVoice(f.env).record({ maxSeconds: 99 });
    if (!('result' in h)) throw new Error('expected a handle');
    await new Promise((r) => setTimeout(r, 5));
    h.stop();
    expect(await h.result).toEqual({ ok: true, text: 'call the dentist' });
    const rec = f.calls.find((c) => c.args.includes('avfoundation'));
    expect(rec?.args).toEqual(expect.arrayContaining(['-ar', '16000', '-ac', '1', '-t', '30']));
    expect(f.stops).toEqual([{ file: 'ffmpeg', quit: true }]);
    expect(f.removed).toEqual(['/tmp/rv']);
  });

  it('can be cancelled, and still deletes the folder', async () => {
    const f = fake((c) => (c.args.includes('avfoundation') ? 'hang' : {}));
    const h = createVoice(f.env).record();
    if (!('result' in h)) throw new Error('expected a handle');
    await new Promise((r) => setTimeout(r, 5));
    h.cancel();
    expect(await h.result).toEqual({ ok: false, message: 'Stopped listening.' });
    expect(f.removed).toEqual(['/tmp/rv']);
  });

  it('explains the microphone permission when ffmpeg cannot open the device', async () => {
    const f = fake(
      (c) =>
        c.args.includes('avfoundation')
          ? { code: 1, stderr: 'Failed to create AV capture input device: Operation not permitted' }
          : {},
      { sizes: {} },
    );
    f.files.delete('/tmp/rv/listen.wav');
    const h = createVoice(f.env).record();
    if (!('result' in h)) throw new Error('expected a handle');
    const r = await h.result;
    expect(!r.ok && r.message).toContain('Microphone');
    expect(!r.ok && r.message).toContain('Terminal');
    expect(f.removed).toEqual(['/tmp/rv']);
  });

  it('names ffmpeg when it is missing', async () => {
    const f = fake(missing('ffmpeg'));
    const h = createVoice(f.env).record();
    if (!('result' in h)) throw new Error('expected a handle');
    expect(await h.result).toEqual({ ok: false, message: NEXT_STEP.ffmpeg });
    expect(f.removed).toEqual(['/tmp/rv']);
  });

  it('does not start without the model', () => {
    const f = fake(() => ({}), { files: [] });
    expect(createVoice(f.env).record()).toEqual({ ok: false, message: NEXT_STEP.model });
    expect(f.calls).toHaveLength(0);
  });
});

describe('speak', () => {
  it('passes the text on stdin, never in a shell command, and flags inside it are harmless', async () => {
    const f = fake(() => ({}));
    const r = await createVoice(f.env).speak('hello -v Zarvox; rm -rf /');
    expect(r.ok).toBe(true);
    const say = f.calls.find((c) => c.file === 'say');
    expect(say?.args).toEqual(['-f', '-']);
    expect(say?.input).toBe('hello -v Zarvox; rm -rf /');
    expect(say?.timeoutMs).toBeGreaterThan(0);
  });

  it('caps long text at a sentence', async () => {
    const f = fake(() => ({}));
    const long = `${'This is a sentence. '.repeat(100)}`;
    const r = await createVoice(f.env).speak(long);
    expect(r.ok && r.spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS);
    expect(r.ok && r.spoken.endsWith('.')).toBe(true);
  });

  it('can be interrupted, and a new one replaces the old', async () => {
    const f = fake((c) => (c.file === 'say' ? 'hang' : {}));
    const v = createVoice(f.env);
    const first = v.speak('One long thing to say.');
    expect(v.isSpeaking()).toBe(true);
    expect(v.stopSpeaking()).toBe(true);
    await first;
    expect(f.stops).toEqual([{ file: 'say', quit: false }]);
    expect(v.isSpeaking()).toBe(false);
    expect(v.stopSpeaking()).toBe(false);
    void v.speak('Two.');
    void v.speak('Three.');
    expect(f.stops).toHaveLength(2);
  });

  it('gives a next step when say is missing, and says nothing for empty text', async () => {
    const f = fake(missing('say'));
    expect(await createVoice(f.env).speak('Hello there')).toEqual({
      ok: false,
      message: NEXT_STEP.say,
    });
    expect((await createVoice(fake(() => ({})).env).speak('```code```')).ok).toBe(false);
  });
});

describe('spokenText', () => {
  it('drops code, links and marks', () => {
    expect(spokenText('**Done.** See [the doc](https://x.io/a) and `ls`.\n```\nrm -rf\n```')).toBe(
      'Done. See the doc and ls.',
    );
  });
  it('cuts a long run with no sentence stop at a word', () => {
    const out = spokenText('word '.repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(51);
  });
});
