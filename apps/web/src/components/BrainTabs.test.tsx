import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrainTabs } from './BrainTabs.tsx';

describe('BrainTabs', () => {
  it('links the three sections in plain words', () => {
    render(<BrainTabs current="notes" />);
    const nav = screen.getByRole('navigation', { name: 'Brain sections' });
    const links = nav.querySelectorAll('a');
    expect([...links].map((a) => a.textContent)).toEqual(['Notes', 'Skills', 'Scheduled jobs']);
    expect(screen.getByRole('link', { name: 'Skills' }).getAttribute('href')).toBe('#/skills');
    expect(screen.getByRole('link', { name: 'Scheduled jobs' }).getAttribute('href')).toBe(
      '#/schedules',
    );
  });

  it('marks only the current section with aria-current', () => {
    render(<BrainTabs current="schedules" />);
    expect(screen.getByRole('link', { name: 'Scheduled jobs' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('link', { name: 'Notes' }).hasAttribute('aria-current')).toBe(false);
    expect(screen.getByRole('link', { name: 'Skills' }).hasAttribute('aria-current')).toBe(false);
  });
});
