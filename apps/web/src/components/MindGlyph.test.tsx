import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIND_STATES, mindLabel } from '../lib/mind.ts';
import { MindGlyph } from './MindGlyph.tsx';

describe('MindGlyph', () => {
  beforeEach(() => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(MIND_STATES)('renders %s with its label', (state) => {
    render(<MindGlyph state={state} />);
    expect(screen.getByRole('img', { name: mindLabel(state) })).toBeTruthy();
  });

  it('switches label when the state changes', () => {
    const { rerender } = render(<MindGlyph state="rest" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Remy is resting');
    rerender(<MindGlyph state="thinking" level={0.4} />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('Remy is thinking');
  });

  it('shows a static cluster without canvas support', () => {
    const { container } = render(<MindGlyph state="working" />);
    expect(container.querySelector('canvas')).toBeNull();
    expect(container.querySelector('pre')?.textContent?.trim().length).toBeGreaterThan(0);
  });
});
