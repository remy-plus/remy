import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App.tsx';

it('renders', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'Remy' })).toBeTruthy();
});
