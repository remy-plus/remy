// The four things the front door offers to start with. Each one has to work with what the person
// has actually set up: no email idea without an email app, no price in a currency they do not use.
import type { ConnectedApp } from '../api/types.ts';

export interface SuggestionContext {
  /** Apps the person has connected. Empty while that is still loading or if it could not be read. */
  apps: Pick<ConnectedApp, 'id' | 'name' | 'blurb' | 'status'>[];
  /** The display currency: its code and the rate per US dollar. */
  currency: { code: string; rate: number };
}

const has = (apps: SuggestionContext['apps'], pattern: RegExp) =>
  apps.some((a) => a.status === 'connected' && (pattern.test(a.id) || pattern.test(a.name)));

/** "$200" for US dollars, "£160" for a rate of 0.8 in pounds; null when the code is not a currency. */
function budget(currency: SuggestionContext['currency']): string | null {
  const rate = Number.isFinite(currency.rate) && currency.rate > 0 ? currency.rate : 1;
  const amount = Math.max(10, Math.round((200 * rate) / 10) * 10);
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: currency.code,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return null;
  }
}

export function suggestionsFor(ctx: SuggestionContext): string[] {
  const price = budget(ctx.currency);
  return [
    'Summarise the files in my Documents folder',
    price
      ? `Find flights to Lisbon in March under ${price}`
      : 'Find cheap flights to Lisbon in March',
    has(ctx.apps, /mail|outlook|inbox/i)
      ? 'Draft a reply to my latest email'
      : 'Write a short note asking my landlord to fix a leaking tap',
    has(ctx.apps, /calendar/i)
      ? 'Plan my week around what is in my calendar'
      : 'Plan my week around a dentist visit on Tuesday',
  ];
}
