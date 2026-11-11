import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VoiceOverlay } from './VoiceOverlay.tsx';

const show = (props: Partial<Parameters<typeof VoiceOverlay>[0]> = {}) =>
  render(
    <VoiceOverlay
      mode="listening"
      listening
      final="Move the Lisbon flight"
      interim=" to Wednesday"
      problem=""
      error=""
      canListen
      onText={() => {}}
      onSend={() => {}}
      onEdit={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );

describe('VoiceOverlay', () => {
  it('shows the words with a drawn cursor, not a typed pipe', () => {
    show();
    const said = screen.getByText(/Move the Lisbon flight/);
    expect(said.textContent).toContain('Move the Lisbon flight');
    expect(said.textContent).toContain('to Wednesday');
    expect(said.textContent).not.toContain('|');
  });

  it('says where the words go and what stays in the browser', () => {
    show();
    expect(screen.getByText(/The audio never leaves this browser/)).toBeTruthy();
    expect(
      screen.getByText(/only the words you\s+send go to Remy, on your own machine/),
    ).toBeTruthy();
  });

  it('says the browser cannot listen and offers the box instead', () => {
    show({ canListen: false, mode: 'editing' });
    expect(screen.getByText("This browser can't listen. Type instead.")).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'What you need done' })).toBeTruthy();
  });

  it('says what went wrong when listening stopped', () => {
    show({ listening: false, problem: 'The microphone is blocked here. Type instead.' });
    expect(screen.getByText('The microphone is blocked here. Type instead.')).toBeTruthy();
  });
});
