import { render, screen } from '@testing-library/react';
import { expect } from 'vitest';
import { App } from '../../App.tsx';
import { ApiProvider } from '../../api/index.tsx';
import { createMockApi } from '../../api/mock.ts';
import type { RemyApi } from '../../api/types.ts';

export const open = (hash: string, api: RemyApi = createMockApi()) => {
  window.location.hash = hash;
  return render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
};

/** Every page has a main landmark, one h1 and no button without a name. */
export const checkLandmarks = () => {
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(screen.getAllByRole('navigation').length).toBeGreaterThan(0);
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  for (const b of screen.queryAllByRole('button')) {
    expect(b.getAttribute('aria-label') || b.textContent?.trim(), b.outerHTML).toBeTruthy();
  }
};
