// Delivery methods and pricing for checkout — the single, centralized place
// this information is allowed to live. Checkout/order code (order-api.mjs)
// only ever calls into this module by delivery-method id; it never
// hardcodes a price or a zone rule itself, and the frontend never computes
// or sends a delivery cost — see validateDeliveryMethod()'s doc comment.
//
// Zones are resolved from the delivery address (country/city) — this is
// the ONE place the actual business rules live (see the site's announcement
// bar copy and tests/api/shipping-rule.test.mjs): Armenia ships free
// regardless of subtotal, U.S. and Russia orders of $150.00 or more ship
// free (inclusive — see qualifiesForFree below), everywhere else pays a flat
// international fee. This is resolved from the customer's real submitted
// delivery address only (order-api.mjs's validateOrderDraft passes
// customerResult.value.country/city here) — never from IP/locale/timezone-
// detected region, which the frontend only ever uses for a pre-checkout UX
// default (see AppContext.jsx's visitorCountry). Adding a new zone (e.g. a
// second Armenian city with its own courier pricing, or a real EU lane)
// means adding one case below — checkout, order-api.mjs, and the frontend
// never need to change.
export const FREE_US_SHIPPING_THRESHOLD = 150;

// 10,000 AMD flat international shipping fee, converted to the store's
// internal USD base using the same AMD exchange rate the frontend uses for
// display (390, see src/data/currency.js) — the historical flat rate this
// module preserves exactly for the "international" and "united_states"
// zones below.
const AMD_TO_USD_RATE = 390;
const FLAT_INTERNATIONAL_FEE_USD = Number((10000 / AMD_TO_USD_RATE).toFixed(2));

const normalize = (value) => String(value || '').trim().toLowerCase();
// Accepts either a real ISO 3166-1 alpha-2 code (every order/address saved
// since the country field became a proper <CountrySelect> — see
// src/data/countries.js) or a historical full-name string (any
// order/address saved before that, e.g. "Armenia"/"United States" — never
// rewritten, so this module has to keep recognizing both shapes forever).
// This is the ONLY place either of those checks happens — order-api.mjs
// always calls resolveZone with the real submitted address, never
// duplicating this matching logic itself.
const isArmenia = (country) => ['armenia', 'am'].includes(normalize(country));
const isUnitedStates = (country) => ['united states', 'us', 'usa'].includes(normalize(country));
const isRussia = (country) => ['russia', 'russian federation', 'ru'].includes(normalize(country));
const isYerevan = (city) => normalize(city) === 'yerevan';

function resolveZone({ country, city }) {
  if (isArmenia(country)) return isYerevan(city) ? 'yerevan' : 'armenia_regional';
  if (isUnitedStates(country)) return 'united_states';
  if (isRussia(country)) return 'russia';
  return 'international';
}

// `carrier` + `handoff` say how a parcel reaches the customer — shown at
// checkout and on the Shipping Policy page (wording: src/data/shippingRules.js's
// deliveryHandoffText): Yerevan door to door; other Armenian regions by
// HayPost to the customer's post office (so a correct postal code is
// required — see order-api.mjs's validateCustomer); United States door to
// door by ONEX; Russia by CDEK to the customer's nearest CDEK branch.
// Every zone has standard delivery only: express (fast) delivery and studio
// pickup are no longer offered. (An old order placed with 'express' or
// 'pickup' keeps its saved label/estimate — see mailer.mjs's
// deliveryMethodLabel — it just can't be selected for a new order.)
function methodsForZone(zone, { subtotal = 0 } = {}) {
  switch (zone) {
    case 'yerevan':
      // "N–M business days" — this is the one place that wording is
      // decided; every display surface (checkout, order confirmation, email,
      // account, admin) shows this exact string, never its own re-worded
      // estimate. Keep in sync with src/data/shippingRules.js's
      // DELIVERY_ESTIMATES (pre-checkout display) and legalPolicies.js.
      return [
        { id: 'standard', label: 'Standard Delivery', description: '3–4 business days', cost: 0, handoff: 'door' },
      ];
    case 'armenia_regional':
      // Free nationwide, same as Yerevan (Armenia has always shipped free —
      // see tests/api/shipping-rule.test.mjs / order-draft.test.mjs) — this
      // zone exists to carry its own ETA and carrier (HayPost), not a
      // different price.
      return [
        { id: 'standard', label: 'Standard Delivery', description: '7–10 business days', cost: 0, carrier: 'HayPost', handoff: 'post_office' },
      ];
    case 'united_states': {
      // Inclusive: a $150.00 order DOES qualify (>=, not >) — the
      // single, authoritative U.S. free-shipping rule every part of the
      // storefront (announcement bar, cart progress bar, product page,
      // checkout) reads from this same module. See tests/api/shipping-rule.test.mjs.
      const qualifiesForFree = subtotal >= FREE_US_SHIPPING_THRESHOLD;
      const standardCost = qualifiesForFree ? 0 : FLAT_INTERNATIONAL_FEE_USD;
      return [
        { id: 'standard', label: 'Standard Delivery', description: qualifiesForFree ? 'Free on orders $150+ — 15–20 business days' : '15–20 business days', cost: standardCost, carrier: 'ONEX', handoff: 'door' },
      ];
    }
    case 'russia': {
      // Same pricing rule as the U.S.: flat fee, free at $150+ (inclusive).
      const qualifiesForFree = subtotal >= FREE_US_SHIPPING_THRESHOLD;
      const standardCost = qualifiesForFree ? 0 : FLAT_INTERNATIONAL_FEE_USD;
      return [
        { id: 'standard', label: 'Standard Delivery', description: qualifiesForFree ? 'Free on orders $150+ — 15–20 business days' : '15–20 business days', cost: standardCost, carrier: 'CDEK', handoff: 'pickup_point' },
      ];
    }
    default: // 'international'
      return [
        { id: 'standard', label: 'Standard Delivery', description: '10–15 business days', cost: FLAT_INTERNATIONAL_FEE_USD },
      ];
  }
}

// subtotal only affects pricing for the 'united_states' and 'russia' zones
// (the free-over-$150 rule) — every other zone's prices are flat regardless of order size.
export function listDeliveryMethods({ country, city, subtotal = 0 } = {}) {
  const zone = resolveZone({ country, city });
  return methodsForZone(zone, { subtotal }).map((method) => ({ ...method, cost: Number(method.cost.toFixed(2)) }));
}

export function getDeliveryMethod({ id, country, city, subtotal = 0 } = {}) {
  return listDeliveryMethods({ country, city, subtotal }).find((method) => method.id === id) || null;
}

// The ONLY place a delivery cost is computed from a client-supplied
// selection — order-api.mjs calls this with the order's real country/city
// (already server-validated) and real server-computed subtotal, never with
// anything the client claims the price should be. A client sending a
// tampered/nonexistent method id is rejected outright.
export function validateDeliveryMethod({ id, country, city, subtotal = 0 } = {}) {
  const method = getDeliveryMethod({ id, country, city, subtotal });
  if (!method) return { error: 'Please select a valid delivery method.' };
  return { value: method };
}

// Backward-compatible default for any caller that predates customer-
// selectable delivery methods (an admin-created order, an older API client,
// or the existing test suite's payloads that never set deliveryMethod) —
// resolves the zone's 'standard' method automatically, reproducing the
// storefront's original automatic-shipping-fee behavior exactly.
export function defaultDeliveryMethod({ country, city, subtotal = 0 } = {}) {
  const methods = listDeliveryMethods({ country, city, subtotal });
  return methods.find((method) => method.id === 'standard') || methods[0] || null;
}
