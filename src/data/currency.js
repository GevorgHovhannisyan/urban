// Single source of truth for currency display/conversion, imported by BOTH
// the frontend (AppContext, Navbar) and the backend (server/*.mjs, via the
// same relative-import-from-src pattern server/seed.mjs already uses for
// data/products.js). Keeping one file means the browser's displayed prices
// and the server's authoritative money math can never drift apart.
//
// These are fixed display-conversion rates, not live market rates — the
// whole app already treats "currency" as a presentation-layer concern:
// every product price, order subtotal/total, and Stripe charge is stored
// and charged in USD internally (see server/order-api.mjs), and `rates`
// only controls what's *shown* to a shopper who picked EUR/AMD as their
// display currency. Gift cards are the first feature to actually store a
// balance in a non-USD currency, so this file also carries the values that
// decision depends on (redemption always converts back to this same table
// server-side — see server/gift-card-api.mjs).
export const CURRENCIES = [
  { code: 'USD', label: 'US Dollar', symbol: '$' },
  { code: 'EUR', label: 'Euro', symbol: '€' },
  { code: 'AMD', label: 'Armenian Dram', symbol: '֏' },
];

// Units of currency per 1 USD.
export const RATES = { USD: 1, EUR: 0.92, AMD: 390 };

export const DEFAULT_CURRENCY = 'USD';

export function isSupportedCurrency(code) {
  return Object.prototype.hasOwnProperty.call(RATES, code);
}

// Gift card preset amounts, scaled sensibly per currency rather than
// reusing the USD numbers literally (an AMD card offering "50" would be
// worth about 13 US cents).
export const GIFT_CARD_PRESETS = {
  USD: [50, 100, 150, 250],
  EUR: [50, 100, 150, 250],
  AMD: [20000, 40000, 60000, 100000],
};

// Min/max purchase amount per currency — roughly the same real-world value
// range ($5–$1000) converted and rounded to clean numbers.
export const GIFT_CARD_LIMITS = {
  USD: { min: 5, max: 1000 },
  EUR: { min: 5, max: 1000 },
  AMD: { min: 2000, max: 400000 },
};
