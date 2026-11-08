import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App.tsx';

it('renders the bar, the logo and the main landmark', () => {
  render(<App />);
  expect(screen.getByRole('img', { name: 'Remy' })).toBeTruthy();
  expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  expect(screen.getByRole('main')).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Skip to main content' }).getAttribute('href')).toBe(
    '#main',
  );
});
