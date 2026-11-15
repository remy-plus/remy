import { describe, expect, it } from 'vitest';
import { firstSuggestions, spendingLine, suggestionsFor } from './suggestions.ts';

const usd = { code: 'USD', rate: 1 };
const app = (id: string, name: string, status: 'connected' | 'not_connected' = 'connected') => ({
  id,
  name,
  blurb: '',
  status,
});

describe('suggestionsFor', () => {
  it('offers four, none about email, when no email app is connected', () => {
    const s = suggestionsFor({ apps: [app('github', 'GitHub')], currency: usd });
    expect(s).toHaveLength(4);
    expect(s.join(' ')).not.toMatch(/email from|reply to my latest/i);
    expect(s.join(' ')).not.toMatch(/Dana/);
  });

  it('offers a reply only once an email app is connected', () => {
    expect(
      suggestionsFor({ apps: [app('gmail', 'Gmail')], currency: usd }).some((x) =>
        x.startsWith('Draft a reply'),
      ),
    ).toBe(true);
    expect(
      suggestionsFor({ apps: [app('gmail', 'Gmail', 'not_connected')], currency: usd }).some((x) =>
        x.startsWith('Draft a reply'),
      ),
    ).toBe(false);
  });

  it('prices in the display currency, not pounds', () => {
    expect(suggestionsFor({ apps: [], currency: usd })[1]).toContain('$200');
    expect(suggestionsFor({ apps: [], currency: { code: 'GBP', rate: 0.8 } })[1]).toContain('£160');
    expect(suggestionsFor({ apps: [], currency: usd }).join(' ')).not.toContain('pounds');
  });

  it('drops the price when the code is not a currency', () => {
    expect(suggestionsFor({ apps: [], currency: { code: 'nope', rate: 1 } })[1]).not.toMatch(/\d/);
  });
});

describe('firstSuggestions', () => {
  it('offers three that need no app, folder or account', () => {
    const s = firstSuggestions({ code: 'USD', rate: 1 });
    expect(s).toHaveLength(3);
    expect(s.join(' ')).not.toMatch(/email|inbox|calendar|folder|Documents|Dana|Gmail|Notion/i);
    expect(s[0]).toContain('$200');
  });

  it('follows the display currency', () => {
    expect(firstSuggestions({ code: 'GBP', rate: 0.8 })[0]).toContain('£160');
  });
});

describe('spendingLine', () => {
  it('says the cap and the currency in one sentence each, with the defaults', () => {
    const l = spendingLine({ monthly: 25, perTask: 2, code: 'USD', rate: 1 });
    expect(l.cap).toBe(
      'Remy stops at $25 a month and $2 on any one task, so a mistake cannot run up a bill.',
    );
    expect(l.currency).toBe('Amounts show in US Dollar (USD).');
  });

  it('shows the cap in the chosen currency', () => {
    const l = spendingLine({ monthly: 25, perTask: 2, code: 'GBP', rate: 0.8 });
    expect(l.cap).toContain('£20 a month');
    expect(l.cap).toContain('£1.60 on any one task');
    expect(l.currency).toBe('Amounts show in British Pound (GBP).');
  });
});
