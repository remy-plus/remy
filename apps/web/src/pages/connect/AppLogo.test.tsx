import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppLogo, monogram } from './ui.tsx';

describe('AppLogo', () => {
  it('keeps the bundled mark for a known app', () => {
    const { container } = render(<AppLogo id="github" name="GitHub" />);
    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('[data-monogram]')).toBeNull();
  });

  it('shows the first letter, uppercased, for an unknown app', () => {
    const { container } = render(<AppLogo id="sentry" name="sentry" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-monogram]')?.textContent).toBe('S');
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe('true');
  });

  it('handles odd names', () => {
    expect(monogram('123 app')).toBe('1');
    expect(monogram('  ')).toBe('·');
    expect(monogram('')).toBe('·');
    expect(monogram('é-mail')).toBe('É');
    expect(monogram('-- Zed')).toBe('Z');
  });
});
