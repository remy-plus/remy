import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Switch as ConnectSwitch } from './pages/connect/ui.tsx';
import { Switch as SettingsSwitch } from './pages/settings/controls.tsx';

// CSS is not applied in these tests, so this guards the hooks the touch rules depend on.
describe('touch targets', () => {
  it('keeps a 44 px rule for coarse pointers, and a hit area for small shapes', () => {
    // The tests run from apps/web (`pnpm --filter @remy/web test`).
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const coarse = css.slice(css.indexOf('@media (pointer: coarse)'));
    expect(coarse).toMatch(/min-height:\s*44px/);
    expect(coarse).toMatch(/\.tap::after/);
    expect(coarse).toMatch(/max\(100%, 44px\)/);
  });

  it('draws switches small and gives them the invisible 44 px hit area', () => {
    render(
      <>
        <SettingsSwitch label="Show Chat" checked onChange={() => {}} />
        <ConnectSwitch label="Read mail" checked onChange={() => {}} />
      </>,
    );
    for (const name of ['Show Chat', 'Read mail']) {
      expect(screen.getByRole('switch', { name }).classList.contains('tap')).toBe(true);
    }
  });
});
