import { describe, expect, it } from 'vitest';
import { suggestionsFor } from './suggestions.ts';

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
