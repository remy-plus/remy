import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MindState } from '../../lib/mind.ts';
import { getSetting, resetSetting } from '../../settings.ts';
import { Composer } from './Composer.tsx';

type Handlers = {
  onresult?: (e: unknown) => void;
  onerror?: (e: { error: string }) => void;
  onend?: () => void;
};
let rec: (Handlers & { started: boolean; aborted: boolean }) | null = null;
class FakeRecognition {
  started = false;
  aborted = false;
  onresult: Handlers['onresult'] = undefined;
  onerror: Handlers['onerror'] = undefined;
  onend: Handlers['onend'] = undefined;
  constructor() {
    rec = this;
  }
  start() {
    this.started = true;
  }
  stop() {}
  abort() {
    this.aborted = true;
  }
}
const win = window as unknown as Record<string, unknown>;
const heard = (final: string, interim = '') =>
  act(() => {
    const results: unknown[] = [{ isFinal: true, 0: { transcript: final } }];
    if (interim) results.push({ isFinal: false, 0: { transcript: interim } });
    rec?.onresult?.({ resultIndex: 0, results });
  });

let tracksStopped = 0;
let closed = 0;
const installFakeAudio = () => {
  const track = { stop: () => tracksStopped++ };
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [track] })) },
  });
  win.AudioContext = class {
    createMediaStreamSource() {
      return { connect() {} };
    }
    createAnalyser() {
      return {
        fftSize: 0,
        getByteTimeDomainData: (a: Uint8Array) => {
          for (let i = 0; i < a.length; i++) a[i] = i % 2 ? 255 : 0;
        },
      };
    }
    async close() {
      closed++;
    }
  };
};

type VoiceNow = { state: MindState | null; level: number };

function Host({
  onVoice,
  onSend,
  answer,
}: {
  onVoice?: (v: VoiceNow) => void;
  onSend?: (v: string) => void;
  answer?: { id: string; text: string };
}) {
  const [v, setV] = useState('');
  return (
    <Composer
      value={v}
      onChange={setV}
      onSend={() => {
        onSend?.(v);
        setV('');
      }}
      {...(onVoice && { onVoice })}
      {...(answer && { answer })}
    />
  );
}

const mic = () => screen.getByRole('button', { name: 'Talk to Remy' });
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};
const tick = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  rec = null;
  tracksStopped = 0;
  closed = 0;
  resetSetting('voice');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'SpeechRecognition');
  Reflect.deleteProperty(window, 'AudioContext');
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

describe('Composer voice input', () => {
  it('says so in plain words when the browser cannot listen', () => {
    render(<Host />);
    fireEvent.click(mic());
    expect(screen.getByRole('alert').textContent).toBe(
      "This browser can't listen. You can still type.",
    );
  });

  it('says so when the microphone is blocked', async () => {
    win.SpeechRecognition = FakeRecognition;
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () =>
          Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })),
      },
    });
    win.AudioContext = class {};
    render(<Host />);
    fireEvent.click(mic());
    await flush();
    expect(screen.getByRole('alert').textContent).toBe(
      "Remy can't hear you. Allow the microphone in your browser, then try again.",
    );
    expect(mic().getAttribute('aria-pressed')).toBe('false');
    expect(rec).toBeNull();
  });

  it('listens, shows level and words, sends after a pause, and releases the mic', async () => {
    vi.useFakeTimers();
    win.SpeechRecognition = FakeRecognition;
    installFakeAudio();
    const states: VoiceNow[] = [];
    const onSend = vi.fn();
    render(<Host onSend={onSend} onVoice={(x) => states.push(x)} />);
    fireEvent.click(mic());
    await flush();
    expect(mic().getAttribute('aria-pressed')).toBe('true');
    expect(rec?.started).toBe(true);
    expect(screen.getByRole('status').textContent).toBe('Listening');
    await tick(200);
    expect(states.some((s) => s.state === 'listening' && s.level > 0.5)).toBe(true);

    heard('book a table', 'for two');
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('book a table');
    expect(screen.getByText('for two')).toBeTruthy();
    heard('book a table for two');
    await tick(1000);
    expect(onSend).not.toHaveBeenCalled(); // the words stay visible first
    await tick(1000);
    expect(onSend).toHaveBeenCalledWith('book a table for two');
    expect(tracksStopped).toBe(1);
    expect(closed).toBe(1);
    expect(mic().getAttribute('aria-pressed')).toBe('false');
  });

  it('Escape stops listening, keeps the words and never sends', async () => {
    vi.useFakeTimers();
    win.SpeechRecognition = FakeRecognition;
    installFakeAudio();
    const onSend = vi.fn();
    render(<Host onSend={onSend} />);
    fireEvent.click(mic());
    await flush();
    heard('hello');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(mic().getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('status').textContent).toBe('Stopped listening');
    expect(rec?.aborted).toBe(true);
    expect(tracksStopped).toBe(1);
    expect(screen.getByRole<HTMLTextAreaElement>('textbox').value).toBe('hello');
    await tick(5000);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('typing after speaking cancels the automatic send', async () => {
    vi.useFakeTimers();
    win.SpeechRecognition = FakeRecognition;
    installFakeAudio();
    const onSend = vi.fn();
    render(<Host onSend={onSend} />);
    fireEvent.click(mic());
    await flush();
    heard('hello there');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello there, Dana' } });
    await tick(5000);
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('Composer spoken replies', () => {
  const spoken: string[] = [];
  let cancelled = 0;
  const installFakeSynth = () => {
    spoken.length = 0;
    cancelled = 0;
    win.SpeechSynthesisUtterance = class {
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      lang = '';
      text: string;
      constructor(text: string) {
        this.text = text;
      }
    };
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        speak: (u: { text: string }) => spoken.push(u.text),
        cancel: () => cancelled++,
      },
    });
  };
  afterEach(() => {
    Reflect.deleteProperty(window, 'speechSynthesis');
    Reflect.deleteProperty(window, 'SpeechSynthesisUtterance');
  });

  it('is off by default and the toggle stores the choice', () => {
    render(<Host />);
    const t = screen.getByRole('button', { name: 'Speak replies' });
    expect(t.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(t);
    expect(t.getAttribute('aria-pressed')).toBe('true');
    expect(getSetting('voice')).toEqual({ speak: true });
  });

  it('speaks a new final answer, shows the mind working, and stops on Stop', () => {
    installFakeSynth();
    const states: Array<MindState | null> = [];
    const onVoice = (v: VoiceNow) => states.push(v.state);
    const { rerender } = render(
      <Host onVoice={onVoice} answer={{ id: 'old', text: 'Old answer.' }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Speak replies' }));
    expect(spoken).toEqual([]); // an answer already there is never read out
    rerender(
      <Host
        onVoice={onVoice}
        answer={{ id: 'new', text: 'Done. The file is saved.\n```\ncode\n```' }}
      />,
    );
    expect(spoken).toEqual(['Done. The file is saved.', 'I put the details on screen.']);
    expect(states.at(-1)).toBe('working');
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(states.at(-1)).toBeNull();
  });

  it('says nothing while the toggle is off', () => {
    installFakeSynth();
    const { rerender } = render(<Host />);
    rerender(<Host answer={{ id: 'a', text: 'Hello.' }} />);
    expect(spoken).toEqual([]);
  });

  it('stops speaking when the person starts talking', async () => {
    installFakeSynth();
    win.SpeechRecognition = FakeRecognition;
    installFakeAudio();
    const { rerender } = render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Speak replies' }));
    rerender(<Host answer={{ id: 'a', text: 'Hello there.' }} />);
    expect(spoken).toEqual(['Hello there.']);
    const before = cancelled;
    fireEvent.click(mic());
    await flush();
    expect(cancelled).toBeGreaterThan(before);
  });
});
