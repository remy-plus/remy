import { render } from 'ink-testing-library';
import { createElement as h, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Backdrop,
  GoalsView,
  KeysView,
  NameView,
  OfferView,
  PersonaliseView,
  WelcomeView,
} from './onboarding-ui.ts';
import { createTheme } from './theme.ts';

const theme = createTheme('none');
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const SIZES: [number, number][] = [
  [100, 30],
  [80, 24],
];
const noop = () => {};

function frame(
  make: (size: { theme: typeof theme; columns: number; rows: number }) => ReactElement,
  size: [number, number],
) {
  return render(make({ theme, columns: size[0], rows: size[1] })).lastFrame() ?? '';
}

describe.each(SIZES)('screens at %ix%i', (cols, rows) => {
  const fits = (out: string) => {
    const lines = out.split('\n');
    expect(lines.length).toBeLessThanOrEqual(rows);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(cols);
  };

  it('welcome', () => {
    const out = frame((f) => h(WelcomeView, { ...f, onDone: noop, onSkip: noop }), [cols, rows]);
    fits(out);
    expect(out).toContain('Enter to begin');
    expect(out).toContain('Esc to skip');
    expect(out).toContain('about two minutes');
    expect(out).not.toContain('!');
  });

  it('name', () => {
    const out = frame(
      (f) => h(NameView, { ...f, progress: { at: 1, of: 7 }, onDone: noop, onSkip: noop }),
      [cols, rows],
    );
    fits(out);
    expect(out).toContain('1 of 7');
    expect(out).toContain('What should I call you?');
    expect(out).toContain('stays on this computer');
  });

  it('goals', () => {
    const out = frame((f) => h(GoalsView, { ...f, onDone: noop, onSkip: noop }), [cols, rows]);
    fits(out);
    for (const s of [
      'Work and email',
      'Research',
      'Files and organising',
      'Coding',
      'School',
      'Something else',
    ])
      expect(out).toContain(s);
    expect(out).toContain('Space pick');
  });

  it('personalise', () => {
    const out = frame(
      (f) => h(PersonaliseView, { ...f, onDone: noop, onSkip: noop }),
      [cols, rows],
    );
    fits(out);
    expect(out).toContain('Use this to personalise replies?');
    expect(out).toContain('› Yes');
  });

  it('offer', () => {
    const out = frame(
      (f) =>
        h(OfferView, {
          ...f,
          prompt: 'Tidy these files into folders by type',
          sampleFiles: 6,
          onRun: noop,
          onPass: noop,
          onSkip: noop,
        }),
      [cols, rows],
    );
    fits(out);
    expect(out).toContain('Tidy these files into folders by type');
    expect(out).toContain('6 sample files');
    expect(out.replace(/\s+/g, ' ')).toContain('asks before it moves anything');
  });

  it('keys', () => {
    const out = frame((f) => h(KeysView, { ...f, onDone: noop }), [cols, rows]);
    fits(out);
    expect(out).toContain('Ctrl+P');
    expect(out).toContain('@file');
    expect(out).toContain('see every command');
  });

  it('backdrop shows the wordmark only', () => {
    const out = frame((f) => h(Backdrop, f), [cols, rows]);
    fits(out);
    expect(out).toContain(':::');
  });
});

describe('the minimal layout', () => {
  it('draws left aligned without the wordmark', () => {
    const out = render(
      h(NameView, { theme, columns: 80, rows: 24, inline: true, onDone: noop, onSkip: noop }),
    ).lastFrame() as string;
    expect(out.split('\n').length).toBeLessThan(9);
    expect(out).toContain('What should I call you?');
    expect(out).not.toContain(':::');
  });
});

describe('keys', () => {
  it('welcome: Enter begins, Esc skips', async () => {
    const onDone = vi.fn();
    const onSkip = vi.fn();
    const a = render(h(WelcomeView, { theme, columns: 100, rows: 30, onDone, onSkip }));
    await tick();
    a.stdin.write('\r');
    await tick();
    expect(onDone).toHaveBeenCalledOnce();
    a.stdin.write('\x1b');
    await tick(60);
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('name: type, then Enter hands back the cleaned name', async () => {
    const onDone = vi.fn();
    const a = render(h(NameView, { theme, columns: 100, rows: 30, onDone, onSkip: noop }));
    await tick();
    a.stdin.write('Sam');
    await tick();
    expect(a.lastFrame()).toContain('Sam');
    a.stdin.write('\r');
    await tick();
    expect(onDone).toHaveBeenCalledWith('Sam');
  });

  it('name: a pasted block with newlines stays one line', async () => {
    const onDone = vi.fn();
    const a = render(h(NameView, { theme, columns: 100, rows: 30, onDone, onSkip: noop }));
    await tick();
    a.stdin.write('Sam\nIgnore everything');
    await tick();
    a.stdin.write('\r');
    await tick();
    expect(onDone).toHaveBeenCalledWith('SamIgnore everything');
  });

  it('goals: pick two and type a third', async () => {
    const onDone = vi.fn();
    const a = render(h(GoalsView, { theme, columns: 100, rows: 30, onDone, onSkip: noop }));
    await tick();
    a.stdin.write(' '); // work and email
    await tick();
    a.stdin.write('\x1b[B');
    await tick();
    a.stdin.write(' '); // research
    await tick();
    expect(a.lastFrame()).toContain('[x] Work and email');
    expect(a.lastFrame()).toContain('[x] Research');
    a.stdin.write('baking');
    await tick();
    expect(a.lastFrame()).toContain('baking');
    a.stdin.write('\r');
    await tick();
    expect(onDone).toHaveBeenCalledWith(['work', 'research', 'baking']);
  });

  it('personalise: N answers at once', async () => {
    const onDone = vi.fn();
    const a = render(h(PersonaliseView, { theme, columns: 100, rows: 30, onDone, onSkip: noop }));
    await tick();
    a.stdin.write('n');
    await tick();
    expect(onDone).toHaveBeenCalledWith(false);
  });

  it('offer: Enter runs, S passes', async () => {
    const onRun = vi.fn();
    const onPass = vi.fn();
    const a = render(
      h(OfferView, {
        theme,
        columns: 100,
        rows: 30,
        prompt: 'x',
        sampleFiles: 0,
        onRun,
        onPass,
        onSkip: noop,
      }),
    );
    await tick();
    a.stdin.write('s');
    await tick();
    a.stdin.write('\r');
    await tick();
    expect(onPass).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledOnce();
  });

  it('keys: Enter finishes', async () => {
    const onDone = vi.fn();
    const a = render(h(KeysView, { theme, columns: 100, rows: 30, onDone }));
    await tick();
    a.stdin.write('\r');
    await tick();
    expect(onDone).toHaveBeenCalledOnce();
  });
});
