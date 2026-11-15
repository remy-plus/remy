import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it } from 'vitest';
import { titleFrom, useDocumentTitle } from './title.ts';

const html = (s: string) => {
  const el = document.createElement('div');
  el.innerHTML = s;
  return el;
};

function Page({ path, heading }: { path: string; heading: string }) {
  const ref = useRef<HTMLElement>(null);
  useDocumentTitle(ref, path);
  return (
    <main ref={ref}>
      <h1>{heading}</h1>
    </main>
  );
}

describe('titleFrom', () => {
  it('uses the first h1, tidied, with the app name', () => {
    expect(titleFrom(html('<h2>x</h2><h1> Your   dock </h1>'))).toBe('Your dock · Remy');
  });
  it('prefers data-doc-title, and falls back to the app name alone', () => {
    expect(titleFrom(html('<h1 data-doc-title="New chat">Good evening</h1>'))).toBe(
      'New chat · Remy',
    );
    expect(titleFrom(html('<p>nothing</p>'))).toBe('Remy');
  });
});

describe('useDocumentTitle', () => {
  it('follows the screen, and a heading that changes after the page loaded', async () => {
    const { rerender } = render(<Page path="/activity" heading="Activity" />);
    expect(document.title).toBe('Activity · Remy');
    rerender(<Page path="/activity" heading="Working now" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(document.title).toBe('Working now · Remy');
    rerender(<Page path="/settings" heading="Settings" />);
    expect(document.title).toBe('Settings · Remy');
  });
});
