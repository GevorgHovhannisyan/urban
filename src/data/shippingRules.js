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

// Delivery-time estimates — mirror server/delivery.mjs's real zone
// descriptions ("Up to 3 business days" for Yerevan, "Up to 7" for the rest
// of Armenia, "Up to 15" for the U.S.); never invented independently here.
// These two are the pre-checkout display values ONLY, for a surface (Cart,
// Product Page) that knows a visitor's country but not their actual
// shipping city yet — ARMENIA_MAX_DELIVERY_DAYS is the honest ceiling that
// holds for either Armenian zone, so showing it never claims Yerevan-speed
// delivery for a shopper who turns out to be elsewhere in the country. The
// real, address-aware estimate (which really can say "Up to 3") only ever
// comes from the backend once a real city is known — see Checkout's live
// /api/delivery-methods fetch and the deliveryEstimate snapshotted onto
// every order at checkout (server/order-api.mjs).
export const ARMENIA_MAX_DELIVERY_DAYS = 7;
export const US_MAX_DELIVERY_DAYS = 15;
