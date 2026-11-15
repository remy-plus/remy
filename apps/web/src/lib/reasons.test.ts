import { describe, expect, it } from 'vitest';
import { plainApprovalReason } from './reasons.ts';

describe('plainApprovalReason', () => {
  it('says what Remy asks before, not what is auto-approved', () => {
    expect(plainApprovalReason("Changing files or data isn't auto-approved")).toBe(
      'Remy asks before changing files.',
    );
    expect(plainApprovalReason("Sending something as you isn't auto-approved")).toBe(
      'Remy asks before sending anything as you.',
    );
    expect(plainApprovalReason("Spending money isn't auto-approved")).toBe(
      'Remy asks before spending money.',
    );
  });

  it('turns the always-ask reasons into sentences', () => {
    expect(plainApprovalReason('Spending money always needs your approval')).toBe(
      'Remy always asks before spending money.',
    );
    expect(plainApprovalReason('An action that cannot be undone always needs your approval')).toBe(
      'Remy always asks before anything that cannot be undone.',
    );
  });

  it('explains the three untrusted-content reasons without the word untrusted', () => {
    const reasons = [
      'this task read untrusted content (a web page, search result, email or pasted text)',
      'this task read untrusted content, and this opens an address nobody has shown it yet',
      'this task read untrusted content, and this sends words you did not give to a form the page chose',
    ];
    const plain = reasons.map(plainApprovalReason);
    for (const p of plain) {
      expect(p).not.toMatch(/untrusted|task read/);
      expect(p.startsWith('Remy read something from outside')).toBe(true);
      expect(p.endsWith('.')).toBe(true);
    }
    expect(new Set(plain).size).toBe(3);
  });

  it('leaves any other reason as it came', () => {
    expect(plainApprovalReason('you always allow send_email')).toBe('you always allow send_email');
    expect(plainApprovalReason('')).toBe('');
  });

  it('does not use exclamation marks', () => {
    expect(plainApprovalReason("Changing files or data isn't auto-approved")).not.toContain('!');
  });
});
