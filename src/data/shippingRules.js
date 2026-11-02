// The ONE frontend constant for the U.S. free-shipping threshold — every
// component that needs to *display* progress toward it (cart drawer, cart
// page, product page) imports this instead of re-declaring its own literal
// 150. This must always match server/delivery.mjs's own
// FREE_US_SHIPPING_THRESHOLD (also mirrored at /api/config's
// freeUsShippingThreshold) — the backend is still the authoritative source
// that actually calculates shipping; this constant only drives pre-checkout
// UI messaging/progress bars, never the real charge.
//
// Represents $150 USD specifically (see server/order-api.mjs's regional
// pricing comments) — if the storefront is displaying another currency,
// convert this value for display only (formatMoney handles that); never
// hardcode a different-currency approximation of this threshold anywhere.
export const FREE_US_SHIPPING_THRESHOLD = 150;

// Inclusive: a subtotal of exactly $150.00 qualifies. Kept as one function
// (not a scattered `>=` at every call site) so the comparison itself can
// never silently drift from server/delivery.mjs's qualifiesForFree check.
export const qualifiesForFreeUsShipping = (subtotal) => Number(subtotal) >= FREE_US_SHIPPING_THRESHOLD;

// Delivery-time estimates (business days) — mirror server/delivery.mjs's
// real zone descriptions, which are what checkout and every order actually
// use; never invented independently here. These are the pre-checkout
// display values only (Cart, Product Page), for surfaces that know a
// visitor's country but not their shipping city yet — so Armenia always
// shows both Yerevan and the regions rather than claiming Yerevan speed.
export const DELIVERY_ESTIMATES = {
  yerevan: '3–4',
  armeniaRegions: '7–10',
  unitedStates: '15–20',
  russia: '15–20',
};

// Countries where the $150 free-shipping threshold applies (flat fee below
// it) — mirrors server/delivery.mjs's 'united_states' and 'russia' zones.
// Armenia always ships free, so it never shows threshold progress.
export const FREE_SHIPPING_THRESHOLD_COUNTRIES = ['US', 'RU'];

// How a delivery method hands the parcel over (server/delivery.mjs's
// `carrier`/`handoff` fields), as one customer-facing line. Exact strings so
// the Armenian/Russian dictionaries translate them.
// `withArea: false` drops the "Armenian regions —" prefix where the area is
// already named (e.g. the Shipping Policy's per-destination cards).
export function deliveryHandoffText(method, { withArea = true } = {}) {
  if (!method) return '';
  if (method.handoff === 'post_office') {
    return withArea
      ? `Armenian regions — delivered by ${method.carrier} to your local post office`
      : `Delivered by ${method.carrier} to your local post office`;
  }
  if (method.handoff === 'pickup_point') return `Delivered by ${method.carrier} to your nearest ${method.carrier} branch`;
  if (method.handoff === 'door') return method.carrier ? `Door-to-door delivery by ${method.carrier}` : 'Door-to-door delivery';
  return '';
}
