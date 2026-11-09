// Display currency. Every amount Remy keeps is in US dollars (providers bill in dollars and the
// cap is a dollar cap). The person picks a currency code and how many of it make one dollar; the
// screens convert at the edge. The rate is theirs to set, so Remy never needs a price feed.
export interface Currency {
  code: string;
  /** How many units of `code` make one US dollar. */
  perUsd: number;
}

export const USD: Currency = { code: 'USD', perUsd: 1 };

/** True for a three-letter code the runtime knows (USD, GBP, JPY, INR, ...). */
export function isCurrencyCode(code: string): boolean {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

/** The sign for a code ("$", "£", "€"), or the code itself when there is no short sign. */
export function symbolOf(code: string): string {
  try {
    const parts = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? code;
  } catch {
    return code;
  }
}

/** "£1.58" for 2 USD at 0.79. Currencies without minor units (JPY) show whole numbers. */
export function formatMoney(usd: number, c: Currency = USD): string {
  const value = usd * c.perUsd;
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: c.code,
      currencyDisplay: 'narrowSymbol',
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${c.code}`;
  }
}
