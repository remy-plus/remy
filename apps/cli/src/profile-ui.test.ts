import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Box } from 'ink';
import { render } from 'ink-testing-library';
import { createElement as h } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createProfileStore } from './profile.ts';
import { ProfilePanel, profileRows } from './profile-ui.ts';
import { createTheme } from './theme.ts';

const theme = createTheme('none');
const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const store = () => {
  const s = createProfileStore(mkdtempSync(join(tmpdir(), 'remy-pp-')));
  s.update({ name: 'Sam', goals: ['research', 'baking'] });
  return s;
};

describe('profile panel', () => {
  it('lists what is saved', () => {
    const rows = profileRows(store().get());
    expect(rows.map((r) => r.detail)).toEqual(['Sam', 'Research, baking', 'on', '']);
    expect(profileRows(undefined)[0]?.detail).toBe('not set');
  });

  it('shows the rows in both layouts', () => {
    for (const dialog of [{ columns: 100, rows: 30 }, { columns: 80, rows: 24 }, undefined]) {
      const out =
        render(
          h(
            Box,
            { width: dialog?.columns ?? 80, height: dialog?.rows ?? 24 },
            h(ProfilePanel, { profile: store(), theme, dialog, onClose: () => {} }),
          ),
        ).lastFrame() ?? '';
      for (const s of ['Your profile', 'Sam', 'Personalise replies', 'Delete profile'])
        expect(out).toContain(s);
    }
  });

  it('flips personalise, edits the name and deletes after asking', async () => {
    const profile = store();
    const onClose = vi.fn();
    const a = render(h(ProfilePanel, { profile, theme, onClose }));
    await tick();
    a.stdin.write('\x1b[B');
    await tick();
    a.stdin.write('\x1b[B');
    await tick();
    a.stdin.write('\r');
    await tick();
    expect(profile.get()?.personalise).toBe(false);
    expect(a.lastFrame()).toContain('off');
    a.stdin.write('\x1b[A');
    await tick();
    a.stdin.write('\x1b[A');
    await tick();
    a.stdin.write('\r');
    await tick();
    expect(a.lastFrame()).toContain('What should I call you?');
    a.stdin.write('ny');
    await tick();
    a.stdin.write('\r');
    await tick();
    expect(profile.get()?.name).toBe('Samny');
    for (let i = 0; i < 3; i++) {
      a.stdin.write('\x1b[B');
      await tick();
    }
    a.stdin.write('\r');
    await tick();
    expect(a.lastFrame()).toContain('Delete your profile?');
    a.stdin.write('n');
    await tick();
    expect(profile.get()).toBeDefined();
    a.stdin.write('\r');
    await tick();
    a.stdin.write('y');
    await tick();
    expect(profile.get()).toBeUndefined();
    expect(onClose).toHaveBeenCalled();
  });
});
