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

/**
 * Three ideas for the very first answer. Each one works with nothing connected: no email, no calendar,
 * no folder. The price follows the display currency.
 */
export function firstSuggestions(currency: SuggestionContext['currency']): string[] {
  const price = budget({ code: currency.code, rate: currency.rate });
  return [
    price
      ? `Compare three well-reviewed headphones under ${price}`
      : 'Compare three well-reviewed headphones',
    'Write a short note asking my landlord to fix a leaking tap',
    'Plan a three-day trip to Lisbon with a rough budget',
  ];
}

const money = (amount: number, code: string): string => {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount}`;
  }
};

/** The cost cap and the display currency, each in one plain sentence, for the first run. */
export function spendingLine(o: { monthly: number; perTask: number; code: string; rate: number }): {
  cap: string;
  currency: string;
} {
  const rate = Number.isFinite(o.rate) && o.rate > 0 ? o.rate : 1;
  let name = o.code;
  try {
    name = new Intl.DisplayNames(['en'], { type: 'currency' }).of(o.code) ?? o.code;
  } catch {
    // an unknown code is shown as typed
  }
  return {
    cap: `Remy stops at ${money(o.monthly * rate, o.code)} a month and ${money(o.perTask * rate, o.code)} on any one task, so a mistake cannot run up a bill.`,
    currency:
      name === o.code ? `Amounts show in ${o.code}.` : `Amounts show in ${name} (${o.code}).`,
  };
}
