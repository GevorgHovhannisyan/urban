import { randomUUID } from 'node:crypto';
import { all, get, run, toJson, fromJson, withTransaction } from './db.mjs';
import { insertSaleTask, shouldFiscalize, kickHdmWorker, receiptTasksByOrderIds, adminReceiptView } from './hdm/fiscalService.mjs';
import { getProduct, getProductsByIds, getVariantStock, tryDecrementVariantStock, clampDecrementVariantStock, restoreVariantStock, isProductPurchasable } from './products-api.mjs';
import { claimEditions, releaseEditionsForOrder } from './edition-api.mjs';
import { validatePromoCode, tryCommitPromoUsage, revertPromoUsage } from './promo-api.mjs';
import { checkGiftCard, tryRedeemGiftCard, revertGiftCardRedemption } from './gift-card-api.mjs';
import { getLoyaltyPoints, pointsValueInDollars, tryRedeemLoyaltyPoints, refundLoyaltyPoints, revokeLoyaltyPoints, awardOrderPoints, reverseOrderLoyalty, REDEMPTION_UNIT_VALUE, POINTS_PER_REDEMPTION_UNIT } from './loyalty.mjs';
import { sendOrderConfirmationEmail, sendOrderStatusEmail, sendAdminNewOrderEmail } from './mailer.mjs';
import { validateDeliveryMethod, defaultDeliveryMethod } from './delivery.mjs';
import { isSupportedShippingCountry } from '../src/data/countries.js';

const clean = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateCustomer(customer = {}) {
  const normalized = {
    firstName: clean(customer.firstName, 60),
    lastName: clean(customer.lastName, 60),
    email: clean(customer.email, 120).toLowerCase(),
    phone: clean(customer.phone, 40),
    country: clean(customer.country, 80),
    city: clean(customer.city, 80),
    postalCode: clean(customer.postalCode, 30),
    address: clean(customer.address, 180),
    // Optional delivery details — never required, unlike the fields above.
    apartment: clean(customer.apartment, 60),
    deliveryNotes: clean(customer.deliveryNotes, 300),
  };

  const requiredFields = ['firstName', 'lastName', 'email', 'phone', 'country', 'city', 'address'];
  const missing = requiredFields.filter((key) => !normalized[key]);

  if (missing.length) return { error: `Missing required fields: ${missing.join(', ')}` };
  if (!emailPattern.test(normalized.email)) return { error: 'Please enter a valid email address.' };
  // The frontend's <CountrySelect> already only offers Armenia/the United
  // States for a real shipping destination (see src/data/countries.js) —
  // this is the real enforcement, never trusting that the client actually
  // used it. A request naming any other country (or a forged/garbled
  // value) is rejected outright, before any pricing/delivery-zone logic
  // ever runs.
  if (!isSupportedShippingCountry(normalized.country)) {
    return { error: 'We currently ship only to Armenia, the United States and Russia. Please select one of those as your delivery country.' };
  }
  // Outside Yerevan, HayPost delivers to the customer's post office, which is
  // found by its 4-digit postal code — so it must be present and valid.
  const inArmenia = ['armenia', 'am'].includes(normalized.country.toLowerCase());
  if (inArmenia && normalized.city.toLowerCase() !== 'yerevan' && !/^\d{4}$/.test(normalized.postalCode)) {
    return { error: 'Please enter the 4-digit postal code of your post office — orders outside Yerevan are delivered by HayPost to your local post office.' };
  }

  return { value: normalized };
}

async function validateItems(items, priceMultiplier = 1, isLoggedIn = false) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'Your cart is empty.' };

  const normalized = [];
  for (const item of items) {
    const product = await getProduct(clean(item.productId, 50));
    const quantity = Number(item.quantity);
    const size = clean(item.size, 20);
    const color = clean(item.color, 40);

    if (!product) return { error: 'One of the products is no longer available.' };
    if (!(await isProductPurchasable(product.id, isLoggedIn))) {
      return { error: `${product.name} isn't available yet.` };
    }
    // A product Admin hasn't priced yet (price left at its 0 placeholder —
    // see server/products-api.mjs's serializeRow) must never be ordered for
    // free. The frontend already hides its Add to Bag for this same reason
    // (ProductPage.jsx/ProductCard.jsx's "Coming Soon" state); this is the
    // real enforcement, independent of anything the client sends.
    if (!(Number(product.price) > 0)) return { error: `${product.name} isn't available for purchase yet.` };
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) return { error: 'Invalid product quantity.' };
    if (!product.sizes.includes(size)) return { error: `Invalid size for ${product.name}.` };
    if (!product.colors.includes(color)) return { error: `Invalid color for ${product.name}.` };

    // The customer picks their own piece number on the product page
    // (LimitedEditionSelector.jsx), so it arrives here as real client input —
    // unlike stock/price, which are never trusted from the client, a chosen
    // serial genuinely originates on the client. What IS never trusted is
    // whether it's actually still free: this pre-check (against the current
    // edition_sales rows) gives an honest, specific error before checkout
    // even starts, but claimEditions() (server/edition-api.mjs, called from
    // commitOrder() below) is what's actually authoritative and race-safe —
    // it re-validates every number again, atomically, at the moment the
    // order is committed, so a number that was free here but got taken in
    // the meantime is still caught and rejected there.
    const editionTotal = product.isLimitedEdition ? Number(product.limitedEditionTotal) || 0 : null;
    const editionNumbers = Array.isArray(item.editionNumbers)
      ? [...new Set(item.editionNumbers.map(Number))].filter((number) => Number.isInteger(number) && number >= 1 && number <= (editionTotal || 0))
      : [];

    if (product.isLimitedEdition) {
      if (!editionTotal) return { error: `${product.name} isn't available for purchase right now.` };
      if (editionNumbers.length !== quantity) {
        return { error: `Choose ${quantity} piece number(s) for ${product.name}.` };
      }
      const soldRows = await all('SELECT number FROM edition_sales WHERE productId = ?', [product.id]);
      const sold = new Set(soldRows.map((row) => row.number));
      const unavailable = editionNumbers.filter((number) => sold.has(number));
      if (unavailable.length) {
        return { error: 'THIS PIECE IS NO LONGER AVAILABLE. PLEASE SELECT ANOTHER NUMBER.' };
      }
    }

    const available = await getVariantStock(product.id, size, color);
    if (available !== null && quantity > available) {
      return available === 0
        ? { error: `${product.name} (${size} / ${color}) is sold out.` }
        : { error: `Only ${available} left of ${product.name} (${size} / ${color}).` };
    }

    normalized.push({
      productId: product.id,
      name: product.name,
      size,
      color,
      quantity,
      // Customer-chosen at product-page selection time — re-validated
      // atomically by claimEditions() at commit time, never trusted as
      // final until that succeeds.
      editionNumbers,
      isLimitedEdition: Boolean(product.isLimitedEdition),
      editionTotal,
      unitPrice: Number((product.price * priceMultiplier).toFixed(2)),
      lineTotal: Number((product.price * priceMultiplier * quantity).toFixed(2)),
    });
  }

  return { value: normalized };
}

// productMap is optional — pass it (from getProductsByIds) when serializing a
// list of orders so N orders costs one product query instead of N * items
// queries. A single order (e.g. trackOrder) falls back to per-item lookups.
function serializeOrder(row, productMap) {
  if (!row) return null;
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    createdAt: row.createdAt,
    status: row.status,
    paymentMethod: row.paymentMethod,
    paymentStatus: row.paymentStatus,
    currency: row.currency,
    region: row.region,
    deliveredAt: row.deliveredAt || null,
    priceMultiplier: Number(row.priceMultiplier),
    customer: {
      firstName: row.customerFirstName,
      lastName: row.customerLastName,
      email: row.customerEmail,
      phone: row.customerPhone,
      country: row.customerCountry,
      city: row.customerCity,
      postalCode: row.customerPostalCode,
      address: row.customerAddress,
      apartment: row.customerApartment || null,
      deliveryNotes: row.deliveryNotes || null,
    },
    items: fromJson(row.items, []).map((item) => {
      const product = productMap ? productMap.get(item.productId) : null;
      return { ...item, image: product?.images?.[0] || null };
    }),
    subtotal: Number(row.subtotal),
    shipping: Number(row.shipping),
    deliveryMethod: row.deliveryMethod || null,
    // The real "Up to N business days" text this exact order was promised
    // at checkout — null only for an order placed before this column
    // existed (see db.mjs's migration comment).
    deliveryEstimate: row.deliveryEstimate || null,
    total: Number(row.total),
    promoCode: row.promoCode || null,
    discountAmount: Number(row.discountAmount || 0),
    giftCardCode: row.giftCardCode || null,
    giftCardAmount: Number(row.giftCardAmount || 0),
    loyaltyDiscount: Number(row.loyaltyDiscount || 0),
    loyaltyPointsUsed: row.loyaltyPointsUsed || 0,
    paymentProvider: row.paymentProvider || null,
    providerTransactionId: row.providerTransactionId || null,
    // 'sandbox' only when this specific order was actually processed while
    // PAYMENT_ENV=sandbox — never inferred from the current server config,
    // so a sandbox-era order stays correctly labeled forever even after the
    // site goes live, and a real production order is never mislabeled just
    // because someone is looking at it from a dev machine.
    paymentEnv: row.paymentEnv || null,
    confirmationEmailSentAt: row.confirmationEmailSentAt || null,
  };
}

async function serializeOrders(rows) {
  const allProductIds = rows.flatMap((row) => fromJson(row.items, []).map((item) => item.productId));
  const productMap = await getProductsByIds(allProductIds);
  return rows.map((row) => serializeOrder(row, productMap));
}

// trackOrder/listOrders don't batch-fetch a product map, so their per-item
// `image` fill-in still needs a lookup — kept as a tiny helper so those two
// call sites don't duplicate the getProductsByIds() plumbing.
async function serializeOrderSingle(row) {
  if (!row) return null;
  const productMap = await getProductsByIds(fromJson(row.items, []).map((item) => item.productId));
  return serializeOrder(row, productMap);
}

function successBody(row) {
  return {
    orderNumber: row.orderNumber,
    status: row.status,
    paymentStatus: row.paymentStatus,
    subtotal: Number(row.subtotal),
    discountAmount: Number(row.discountAmount || 0),
    giftCardAmount: Number(row.giftCardAmount || 0),
    loyaltyDiscount: Number(row.loyaltyDiscount || 0),
    loyaltyPointsUsed: row.loyaltyPointsUsed || 0,
    shipping: Number(row.shipping),
    internationalSurcharge: Number(row.shipping),
    deliveryMethod: row.deliveryMethod || null,
    paymentEnv: row.paymentEnv || null,
    total: Number(row.total),
    message: row.status === 'confirmed'
      ? 'Your order has been confirmed.'
      : 'Your order has been created. Connect a payment provider to charge online payments.',
  };
}

// 'cash_on_delivery' is a real, permanent, production payment method (not a
// dev-only/test flag) — see createOrder() below for how it's committed.
// 'idram' is a real online payment (server/payment/idramService.mjs) and is
// rejected by createOrder(). paypal/telcell remain manual/unconnected
// placeholders pending a real integration (not offered in the checkout UI). A legacy client sending the
// old, retired 'cash' value is rejected by validateOrderDraft() below, same
// as any other invalid value — 'cash_on_delivery' is a distinct value from
// that retired one.
const ALLOWED_PAYMENT_METHODS = new Set(['card', 'cash_on_delivery', 'paypal', 'idram', 'telcell']);
// Re-exported for backward compatibility (server/app.mjs's /api/config, the
// frontend's live client-side preview) — the real value now lives in
// server/delivery.mjs, the single centralized source of delivery pricing.
export { FREE_US_SHIPPING_THRESHOLD } from './delivery.mjs';

// Validates + computes everything about an order (customer, items, shipping,
// promo/discount, total) without touching the database. Shared by the direct
// checkout flow (createOrder, below) and the online-payment flow (server/payment/paymentService.mjs),
// which needs the same validated numbers before it ever creates a Checkout
// Session, but must not claim editions/promo usage or insert a row until
// payment actually succeeds.
export async function validateOrderDraft(payload = {}) {
  const customerResult = validateCustomer(payload.customer);
  if (customerResult.error) return { error: customerResult.error };

  const isUnitedStates = clean(payload.region, 20).toUpperCase() === 'US' || payload.regionalPricing === true;
  const priceMultiplier = isUnitedStates ? 1.15 : 1;
  const itemsResult = await validateItems(payload.items, priceMultiplier, Boolean(payload.customerId));
  if (itemsResult.error) return { error: itemsResult.error };

  const paymentMethod = clean(payload.paymentMethod, 30);
  if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) return { error: 'Please select a valid payment method.' };

  const subtotal = itemsResult.value.reduce((sum, item) => sum + item.lineTotal, 0);

  // Delivery cost is ALWAYS computed here, server-side, from the delivery
  // module (server/delivery.mjs) — never trusted from the client. The real
  // checkout flow always sends a deliveryMethod id the shopper picked from
  // /api/delivery-methods; any caller that predates customer-selectable
  // delivery methods (an older API client, an admin-created order, this
  // project's own pre-delivery-selection tests) falls back to the zone's
  // 'standard' method automatically, reproducing the storefront's original
  // automatic-shipping-fee behavior exactly.
  const deliveryContext = { country: customerResult.value.country, city: customerResult.value.city, subtotal };
  let deliveryResult;
  if (payload.deliveryMethod) {
    deliveryResult = { value: validateDeliveryMethod({ id: payload.deliveryMethod, ...deliveryContext }).value };
    if (!deliveryResult.value) return { error: 'Please select a valid delivery method.' };
  } else {
    deliveryResult = { value: defaultDeliveryMethod(deliveryContext) };
    if (!deliveryResult.value) return { error: 'No delivery method is available for this address.' };
  }
  const deliveryMethod = deliveryResult.value.id;
  const deliveryMethodLabel = deliveryResult.value.label;
  // The real, resolved delivery-time estimate (e.g. "3–4 business days"
  // for Yerevan vs "7–10 business days" elsewhere in Armenia) — resolved
  // here from the customer's actual submitted city via server/delivery.mjs,
  // never guessed. Snapshotted onto the order below (commitOrder) so it
  // survives unchanged even if delivery.mjs's stated estimates are updated
  // later.
  const deliveryEstimate = deliveryResult.value.description;
  const shipping = deliveryResult.value.cost;

  let discountAmount = 0;
  let appliedPromoCode = null;
  const rawPromoCode = clean(payload.promoCode, 40);
  if (rawPromoCode) {
    const promoResult = await validatePromoCode(rawPromoCode, subtotal);
    if (!promoResult.valid) return { error: promoResult.error };
    discountAmount = promoResult.discountAmount;
    appliedPromoCode = promoResult.promo.code;
  }

  const preGiftCardTotal = Math.max(0, subtotal - discountAmount) + shipping;

  let giftCardAmount = 0;
  let appliedGiftCardCode = null;
  const rawGiftCardCode = clean(payload.giftCardCode, 40);
  if (rawGiftCardCode) {
    const giftCardResult = await checkGiftCard(rawGiftCardCode);
    if (!giftCardResult.valid) return { error: giftCardResult.error };
    // Orders are always USD-denominated internally (see src/data/currency.js)
    // — balanceUsd is the card's native balance already converted, so this
    // comparison is never mixing units even when the card was purchased in
    // EUR/AMD. tryRedeemGiftCard() re-derives the same conversion at commit
    // time rather than trusting this pre-check value.
    giftCardAmount = Number(Math.min(giftCardResult.giftCard.balanceUsd, preGiftCardTotal).toFixed(2));
    appliedGiftCardCode = giftCardResult.giftCard.code;
  }

  const preLoyaltyTotal = Math.max(0, preGiftCardTotal - giftCardAmount);

  // Only a logged-in customer has a points balance to spend, and only when
  // they actually opt in — this is a discount, not something silently
  // applied, so it must be explicit even though the Rewards page advertises
  // it as "automatic" once requested.
  let loyaltyDiscount = 0;
  let pointsToRedeem = 0;
  if (payload.useLoyaltyPoints && payload.customerId) {
    const availableValue = pointsValueInDollars(await getLoyaltyPoints(payload.customerId));
    const redeemableAgainstTotal = Math.floor(preLoyaltyTotal / REDEMPTION_UNIT_VALUE) * REDEMPTION_UNIT_VALUE;
    loyaltyDiscount = Number(Math.min(availableValue, redeemableAgainstTotal).toFixed(2));
    pointsToRedeem = (loyaltyDiscount / REDEMPTION_UNIT_VALUE) * POINTS_PER_REDEMPTION_UNIT;
  }

  const total = Number((preLoyaltyTotal - loyaltyDiscount).toFixed(2));

  return {
    value: {
      customer: customerResult.value,
      items: itemsResult.value,
      isUnitedStates,
      priceMultiplier,
      paymentMethod,
      subtotal,
      shipping,
      deliveryMethod,
      deliveryMethodLabel,
      deliveryEstimate,
      discountAmount,
      appliedPromoCode,
      giftCardAmount,
      appliedGiftCardCode,
      loyaltyDiscount,
      pointsToRedeem,
      total,
      customerId: payload.customerId || null,
    },
  };
}

// Claims editions, atomically commits promo usage, and inserts the order row.
// `status`/`paymentStatus` let the caller decide the outcome (a direct
// createOrder() call always arrives "payment_pending"; a Stripe-confirmed
// order arrives here already "paid" from the webhook — this function never
// decides payment state itself).
//
// enforceStock (default true): whether insufficient stock should reject the
// order outright. Direct/not-yet-paid orders (createOrder) always enforce —
// rejecting there is free, nothing has been charged. completePayment()
// passes false: by the time its webhook fires, Stripe has already charged
// the customer, so rejecting here would mean "charged with no order and no
// product" — a worse outcome than the documented one (stock overcommitted
// by the race window, clamped at 0, never negative). Deciding whether to
// auto-refund/cancel in that case is a real policy call this pass doesn't
// make; see the "KNOWN RISK" tests in tests/api/stripe-webhook.test.mjs for
// the reasoning this preserves.
async function commitOrder(draft, { status, paymentStatus, idempotencyKey, enforceStock = true, paymentProvider = null, providerTransactionId = null, paymentEnv = null, paidAmount = null, paidCurrency = null }) {
  if (idempotencyKey) {
    const existing = await get('SELECT * FROM orders WHERE idempotencyKey = ?', [idempotencyKey]);
    if (existing) return { status: 201, body: successBody(existing) };
  }

  const now = new Date();
  const orderNumber = `UP-${now.getUTCFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
  const id = randomUUID();

  try {
    await claimEditions(draft.items, id);
  } catch (error) {
    return { status: 409, body: { error: error.message || 'A selected edition number is no longer available.' } };
  }

  if (draft.appliedPromoCode && !(await tryCommitPromoUsage(draft.appliedPromoCode))) {
    return { status: 400, body: { error: 'This promo code just reached its usage limit. Please remove it and try again.' } };
  }

  let redeemedGiftCardAmount = 0;
  if (draft.appliedGiftCardCode) {
    redeemedGiftCardAmount = await tryRedeemGiftCard(draft.appliedGiftCardCode, draft.giftCardAmount, id);
    if (redeemedGiftCardAmount < draft.giftCardAmount) {
      if (redeemedGiftCardAmount > 0) await revertGiftCardRedemption(draft.appliedGiftCardCode, redeemedGiftCardAmount);
      if (draft.appliedPromoCode) await revertPromoUsage(draft.appliedPromoCode);
      return { status: 400, body: { error: 'This gift card balance just changed. Please refresh and try again.' } };
    }
  }

  let redeemedLoyaltyAmount = 0;
  if (draft.loyaltyDiscount > 0 && !enforceStock) {
    // Already charged with the points discount applied (Stripe webhook) —
    // rejecting now would mean "paid, no order". Deduct what was priced in,
    // clamped at 0 if the balance changed in another tab meanwhile.
    await revokeLoyaltyPoints(draft.customerId, draft.pointsToRedeem);
    redeemedLoyaltyAmount = draft.loyaltyDiscount;
  } else if (draft.loyaltyDiscount > 0) {
    redeemedLoyaltyAmount = await tryRedeemLoyaltyPoints(draft.customerId, draft.loyaltyDiscount);
    if (redeemedLoyaltyAmount < draft.loyaltyDiscount) {
      if (redeemedLoyaltyAmount > 0) await refundLoyaltyPoints(draft.customerId, redeemedLoyaltyAmount);
      if (redeemedGiftCardAmount > 0) await revertGiftCardRedemption(draft.appliedGiftCardCode, redeemedGiftCardAmount);
      if (draft.appliedPromoCode) await revertPromoUsage(draft.appliedPromoCode);
      return { status: 400, body: { error: 'Your points balance just changed. Please refresh and try again.' } };
    }
  }

  // Atomic per-item: see tryDecrementVariantStock()'s doc comment for why
  // this can still fail here even though validateItems() already checked
  // stock earlier — a genuinely concurrent order for the same variant can
  // win the race in between. On failure (only possible when enforceStock),
  // unwind everything this call has committed so far (any earlier items'
  // reservations in *this* order, plus the promo/gift-card/loyalty commits
  // above) so a rejected order never leaves partial state behind.
  const reservedItems = [];
  for (const item of draft.items) {
    const reserved = await tryDecrementVariantStock(item.productId, item.size, item.color, item.quantity);
    if (!reserved) {
      if (!enforceStock) {
        // Already-charged Stripe order — commit anyway; see this function's
        // doc comment. Preserves the exact pre-fix "clamp at 0" behavior
        // rather than leaving a partial shortfall's stock untouched.
        await clampDecrementVariantStock(item.productId, item.size, item.color, item.quantity);
        reservedItems.push(item);
        continue;
      }
      for (const done of reservedItems) {
        await restoreVariantStock(done.productId, done.size, done.color, done.quantity);
      }
      if (redeemedLoyaltyAmount > 0) await refundLoyaltyPoints(draft.customerId, redeemedLoyaltyAmount);
      if (redeemedGiftCardAmount > 0) await revertGiftCardRedemption(draft.appliedGiftCardCode, redeemedGiftCardAmount);
      if (draft.appliedPromoCode) await revertPromoUsage(draft.appliedPromoCode);
      return { status: 409, body: { error: `${item.name} (${item.size} / ${item.color}) just sold out. Please review your bag and try again.` } };
    }
    reservedItems.push(item);
  }

  // A verified online payment that needs a fiscal receipt (ՀԴՄ): the
  // receipt task is written in the SAME transaction as the paid order, so a
  // paid order can never exist without its task (or vice versa) — see
  // server/hdm/fiscalService.mjs.
  const fiscalize = paymentStatus === 'paid' && paidCurrency === 'AMD' && Number(paidAmount) > 0
    && shouldFiscalize({ provider: paymentProvider, paymentEnv });
  try {
    await withTransaction(async (tx) => {
      await tx.run(
        `INSERT INTO orders (
          id, orderNumber, createdAt, status, paymentMethod, paymentStatus, currency, region, priceMultiplier,
          customerFirstName, customerLastName, customerEmail, customerPhone, customerCountry, customerCity,
          customerPostalCode, customerAddress, customerApartment, deliveryNotes, items, subtotal, shipping, total, promoCode, discountAmount, customerId,
          idempotencyKey, giftCardCode, giftCardAmount, loyaltyDiscount, loyaltyPointsUsed, loyaltyPointsGranted, deliveryMethod, deliveryEstimate,
          paymentProvider, providerTransactionId, paymentEnv, paidAmount, paidCurrency
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, orderNumber, now.toISOString().slice(0, 19).replace('T', ' '), status, draft.paymentMethod, paymentStatus, 'USD',
          draft.isUnitedStates ? 'US' : 'OTHER', draft.priceMultiplier,
          draft.customer.firstName, draft.customer.lastName, draft.customer.email,
          draft.customer.phone, draft.customer.country, draft.customer.city,
          draft.customer.postalCode, draft.customer.address, draft.customer.apartment || null, draft.customer.deliveryNotes || null,
          toJson(draft.items), draft.subtotal, draft.shipping, draft.total, draft.appliedPromoCode, draft.discountAmount, draft.customerId,
          idempotencyKey, draft.appliedGiftCardCode, draft.giftCardAmount, draft.loyaltyDiscount, draft.pointsToRedeem, 0, draft.deliveryMethod || null, draft.deliveryEstimate || null,
          paymentProvider, providerTransactionId, paymentEnv, paidAmount, paidCurrency,
        ]
      );
      if (fiscalize) {
        await insertSaleTask(tx, { orderId: id, amount: paidAmount, currency: paidCurrency, provider: paymentProvider, providerTransactionId });
      }
    });
    // Points are earned only once the order is actually paid — a Stripe
    // order is paid here; cash on delivery / manual methods earn when an
    // admin marks them Paid (updateOrderStatus). See server/loyalty.mjs.
    if (paymentStatus === 'paid') await awardOrderPoints(id);
  } catch (error) {
    // Two concurrent requests with the same idempotency key can both pass the
    // pre-check above; the UNIQUE index is the real guard against a duplicate
    // order in that race — fall back to returning the one that won.
    if (idempotencyKey && (error?.code === 'ER_DUP_ENTRY' || String(error?.message || '').includes('idx_orders_idempotency_key'))) {
      const existing = await get('SELECT * FROM orders WHERE idempotencyKey = ?', [idempotencyKey]);
      if (existing) {
        // This request's own INSERT lost the race to a duplicate — its promo
        // commit and gift card redemption above were for an order that was
        // never actually created.
        if (draft.appliedPromoCode) await revertPromoUsage(draft.appliedPromoCode);
        if (redeemedGiftCardAmount > 0) await revertGiftCardRedemption(draft.appliedGiftCardCode, redeemedGiftCardAmount);
        if (redeemedLoyaltyAmount > 0) await refundLoyaltyPoints(draft.customerId, redeemedLoyaltyAmount);
        return { status: 201, body: successBody(existing) };
      }
    }
    throw error;
  }

  const row = await get('SELECT * FROM orders WHERE id = ?', [id]);

  // The order is committed. Emails go out in the background: nothing about
  // them may delay or fail this response — the payment provider's callback
  // (Idram's RESULT_URL waits for our "OK") and the customer's redirect both
  // run through here. Fires only on a fresh INSERT, never from the
  // idempotency-duplicate branches above. A send that fails (or a process
  // restart before it finishes) is picked up again by
  // retryPendingConfirmationEmails().
  queueOrderEmails(id);
  if (fiscalize) kickHdmWorker();

  return { status: 201, body: successBody(row) };
}

function queueOrderEmails(orderId) {
  setImmediate(async () => {
    await sendConfirmationForOrder(orderId);
    try {
      const order = await serializeOrderSingle(await get('SELECT * FROM orders WHERE id = ?', [orderId]));
      // Store-owner alert — best effort, never affects the customer's order.
      if (order) await sendAdminNewOrderEmail({ order });
    } catch (error) {
      console.error(`[mail] admin new-order alert for order ${orderId} failed: ${error.message}`);
    }
  });
}

// ---------- Order confirmation email: send, record, retry ----------
// Backoff between attempts: 5, 10, 20, 40, 80, 160, 320 minutes, then it
// stops (about 10.5 hours of retries) and the error stays on the order for
// the admin to see (Admin → Orders → order details) and resend by hand
// (scripts/order-email.mjs).
const CONFIRMATION_MAX_ATTEMPTS = 8;
// Only orders this recent are retried automatically, so turning the sweep on
// can never email customers about old orders.
const CONFIRMATION_RETRY_WINDOW_HOURS = 72;

const sqlNow = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

// Sends the confirmation email for one order and records the outcome on it
// (confirmationEmailSentAt / confirmationEmailError / attempts). Never throws.
// Skips orders that were already emailed. The UPDATE…WHERE claim makes sure
// two callers (the checkout itself and the retry sweep) can't send the same
// email twice at the same moment.
export async function sendConfirmationForOrder(orderId) {
  let orderNumber = orderId;
  try {
    const claim = await run(
      `UPDATE orders SET confirmationEmailAttempts = confirmationEmailAttempts + 1, confirmationEmailLastAttemptAt = ?
        WHERE id = ? AND confirmationEmailSentAt IS NULL
          AND (confirmationEmailLastAttemptAt IS NULL OR confirmationEmailLastAttemptAt < ?)`,
      [sqlNow(), orderId, new Date(Date.now() - 2 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')]
    );
    if (!claim.affectedRows) return { sent: false, skipped: true };
    const row = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
    orderNumber = row.orderNumber;
    // serializeOrderSingle (not bare serializeOrder) so each item carries its
    // real product image in the email instead of the monogram placeholder.
    const result = await sendOrderConfirmationEmail({ order: await serializeOrderSingle(row) });
    await run('UPDATE orders SET confirmationEmailSentAt = ?, confirmationEmailError = ? WHERE id = ?', [
      result.sent ? sqlNow() : null,
      result.sent ? null : clean(result.error || 'Email was not sent (mail is not configured).', 1000),
      orderId,
    ]);
    if (!result.sent) console.error(`[mail] order confirmation #${orderNumber} NOT sent (attempt ${row.confirmationEmailAttempts}/${CONFIRMATION_MAX_ATTEMPTS}): ${result.error || 'mail is not configured'}`);
    return result;
  } catch (error) {
    // Anything unexpected (building the email, a DB hiccup): log it loudly
    // and leave it on the order so the retry sweep and the admin can see it.
    console.error(`[mail] order confirmation #${orderNumber} FAILED:`, error);
    await run('UPDATE orders SET confirmationEmailError = ? WHERE id = ?', [clean(`Unexpected error: ${error.message}`, 1000), orderId]).catch(() => {});
    return { sent: false, error: error.message };
  }
}

// Runs every few minutes from server.mjs. Picks up recent orders whose
// confirmation email failed or never went out, respecting the backoff above.
// Cancelled/refunded orders are skipped.
export async function retryPendingConfirmationEmails() {
  const rows = await all(
    `SELECT id, confirmationEmailAttempts AS attempts, confirmationEmailLastAttemptAt AS lastAttempt FROM orders
      WHERE confirmationEmailSentAt IS NULL
        AND status <> 'cancelled' AND paymentStatus <> 'refunded'
        AND confirmationEmailAttempts < ?
        AND createdAt >= ?
      ORDER BY createdAt ASC LIMIT 25`,
    [CONFIRMATION_MAX_ATTEMPTS, new Date(Date.now() - CONFIRMATION_RETRY_WINDOW_HOURS * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')]
  );
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    // DATETIMEs are stored and read back as UTC 'YYYY-MM-DD HH:MM:SS' strings.
    const last = row.lastAttempt ? new Date(`${String(row.lastAttempt).replace(' ', 'T')}Z`).getTime() : 0;
    const waitMs = row.attempts > 0 ? 5 * 60 * 1000 * 2 ** (row.attempts - 1) : 0;
    if (last && Date.now() - last < waitMs) continue;
    const result = await sendConfirmationForOrder(row.id);
    if (result.sent) sent += 1;
    else if (!result.skipped) failed += 1;
  }
  return { sent, failed };
}

export async function createOrder(payload = {}) {
  const idempotencyKey = clean(payload.idempotencyKey, 100) || null;
  if (idempotencyKey) {
    const existing = await get('SELECT * FROM orders WHERE idempotencyKey = ?', [idempotencyKey]);
    if (existing) return { status: 201, body: successBody(existing) };
  }

  const draftResult = await validateOrderDraft(payload);
  if (draftResult.error) return { status: 400, body: { error: draftResult.error } };
  const draft = draftResult.value;

  // Idram is a real online payment now (server/payment/idramService.mjs):
  // an Idram order may only ever be created by Idram's signed payment
  // confirmation, never as an unpaid order through this direct endpoint.
  if (draft.paymentMethod === 'idram') {
    return { status: 400, body: { error: 'Idram payments must be completed through Idram checkout.' } };
  }

  // A limited-edition serial is only ever taken by a completed purchase:
  // card (ArCa/Stripe) and Idram claim it once the payment is verified, and
  // Cash on Delivery once the order is actually placed. Every other method
  // on this endpoint creates an UNPAID "payment_pending" order, which would
  // otherwise lock the serial for everyone else without anyone paying.
  if (draft.paymentMethod !== 'cash_on_delivery' && draft.items.some((item) => item.isLimitedEdition)) {
    return { status: 400, body: { error: 'Limited edition pieces can only be bought by card, Idram or cash on delivery.' } };
  }

  // Cash on Delivery is a real, immediate order — there is no online payment
  // step to wait for, so it confirms right away (same as a Stripe order
  // confirms once the webhook verifies payment). paymentStatus stays
  // 'not_charged' either way: no money has actually changed hands yet for a
  // COD order, which is exactly what that status means — it must never be
  // set to 'paid' here (see updateOrderStatus() for when an admin later
  // marks it paid on physical delivery). Every other remaining payment
  // method (paypal/idram/telcell) is still an unconnected manual placeholder
  // and stays 'payment_pending' until an admin manually confirms it came
  // through.
  const isCashOnDelivery = draft.paymentMethod === 'cash_on_delivery';
  return commitOrder(draft, {
    status: isCashOnDelivery ? 'confirmed' : 'payment_pending',
    paymentStatus: 'not_charged',
    idempotencyKey,
  });
}

// Called only from the payment webhook (or its client-facing fallback
// verification path — see server/payment/paymentService.mjs) once the
// payment provider has confirmed the payment actually succeeded — never from
// a route that merely trusts a client-supplied "success" flag. `provider`
// (e.g. 'stripe') and `providerTransactionId` (the provider's own PaymentIntent
// id) are recorded on the order for support/reconciliation; `paymentEnv`
// ('sandbox' or 'production') records which environment actually processed
// the charge, so a sandbox-processed order can never be mistaken for a real
// one in the admin panel even if PAYMENT_ENV is later flipped to production.
// `paidAmount`/`paidCurrency`: what the provider confirmed was charged
// (ArCa/Idram: the AMD amount verified against the provider) — recorded on
// the order and used for the fiscal receipt.
export async function completePayment(draft, { provider, providerTransactionId, pendingCheckoutId, paymentEnv, paidAmount = null, paidCurrency = null }) {
  // enforceStock: false — the customer has already been charged by the time
  // this runs (see commitOrder()'s doc comment); this order must be
  // committed regardless of a stock race in the meantime.
  return commitOrder(draft, {
    status: 'confirmed',
    paymentStatus: 'paid',
    idempotencyKey: `${provider}:${pendingCheckoutId}`,
    enforceStock: false,
    paymentProvider: provider,
    providerTransactionId,
    paymentEnv,
    paidAmount,
    paidCurrency,
  });
}

export async function trackOrder(orderNumber) {
  const row = await get('SELECT * FROM orders WHERE orderNumber = ?', [clean(orderNumber, 40)]);
  if (!row) return { status: 404, body: { error: 'Order not found.' } };
  return { status: 200, body: { order: await serializeOrderSingle(row) } };
}

export async function listOrdersByEmail(email) {
  const normalized = clean(email, 120).toLowerCase();
  if (!normalized) return { status: 400, body: { error: 'Email is required.' } };
  const rows = await all('SELECT * FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC', [normalized]);
  return { status: 200, body: { orders: await serializeOrders(rows) } };
}

// Admin only (GET /api/admin/orders). Adds the confirmation email's delivery
// details, which the customer-facing serializers deliberately leave out.
export async function listOrders() {
  const rows = await all('SELECT * FROM orders ORDER BY createdAt DESC');
  const orders = await serializeOrders(rows);
  const receipts = await receiptTasksByOrderIds(rows.map((row) => row.id));
  return orders.map((order, i) => ({
    ...order,
    confirmationEmailError: rows[i].confirmationEmailError || null,
    confirmationEmailAttempts: Number(rows[i].confirmationEmailAttempts || 0),
    paidAmount: rows[i].paidAmount != null ? Number(rows[i].paidAmount) : null,
    paidCurrency: rows[i].paidCurrency || null,
    // Fiscal receipt (ՀԴՄ) — its own status, separate from payment and email.
    fiscalReceipt: adminReceiptView(receipts.get(rows[i].id), rows[i].orderNumber),
  }));
}

// Verified Purchase Reviews: an order only counts as a real purchase once
// it's past the "did this actually happen" line — not merely created.
// 'payment_pending' (every direct paypal/idram/telcell order starts here,
// and stays there until an admin manually confirms the payment came
// through — see updateOrderStatus()'s own comments) is deliberately
// excluded via the status whitelist below: creating an order is not the
// same as paying for it. A cancelled order is excluded outright (not in the
// whitelist), and a refunded order is excluded regardless of what `status`
// it's still carrying, since the money was given back — matches this
// feature's "cancelled/failed/refunded don't qualify" requirement exactly.
//
// Server-authoritative purchase check for Verified Purchase Reviews
// (server/review-api.mjs). Never trusts anything the client claims about
// having bought something — this only ever trusts `customerId` (the `sub`
// claim off a verified JWT, see customer-auth.mjs's requireCustomer) and
// `customerEmail` (read from that same customer's own row in the database,
// never from request input) and looks the purchase up directly.
//
// Matches on customerId OR customerEmail because an order placed as a guest
// (no account existed yet, or the shopper simply didn't log in at checkout)
// still has customerId NULL but a real customerEmail — matching on email
// too means a shopper who later creates/logs into an account with that same
// address still gets correctly recognized as having bought it. Both sides
// of the OR are still 100% server-derived (customerId from the JWT,
// customerEmail from the customer's own row keyed by that same JWT's sub) —
// nothing here ever reads a client-supplied identity value.
//
// Returns the qualifying order's id (truthy) on success, or null. Returning
// the order id (not just a boolean) lets the caller stamp the review with
// exactly which order earned it, for an audit trail.
export async function findQualifyingOrderId(customerId, customerEmail, productId) {
  const cleanProductId = clean(productId, 80);
  if (!cleanProductId || (!customerId && !customerEmail)) return null;

  const rows = await all(
    `SELECT id, items FROM orders
     WHERE (customerId = ? OR customerEmail = ?)
       AND status IN ('confirmed', 'processing', 'shipped', 'delivered')
       AND paymentStatus != 'refunded'
     ORDER BY createdAt DESC`,
    [customerId || '', (customerEmail || '').toLowerCase()]
  );

  for (const row of rows) {
    const items = fromJson(row.items, []);
    if (items.some((item) => item.productId === cleanProductId)) return row.id;
  }
  return null;
}

export async function updateOrderStatus(id, { status, paymentStatus }) {
  const orderId = clean(id, 80);
  const existing = await get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!existing) return { status: 404, body: { error: 'Order not found.' } };

  const allowedStatus = new Set(['payment_pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled']);
  // 'pay_on_delivery' intentionally excluded — cash on delivery was removed
  // and can no longer be set going forward. A pre-existing historical order
  // that already has this value keeps it; it's just no longer assignable.
  const allowedPaymentStatus = new Set(['not_charged', 'paid', 'refunded']);

  const updates = [];
  const values = [];
  if (status !== undefined) {
    if (!allowedStatus.has(status)) return { status: 400, body: { error: 'Invalid order status.' } };
    updates.push('status = ?');
    values.push(status);
  }
  if (paymentStatus !== undefined) {
    if (!allowedPaymentStatus.has(paymentStatus)) return { status: 400, body: { error: 'Invalid payment status.' } };
    updates.push('paymentStatus = ?');
    values.push(paymentStatus);
  }
  if (!updates.length) return { status: 400, body: { error: 'No changes provided.' } };

  // Cancelling an order should undo everything it earned/spent/reserved —
  // otherwise a customer keeps loyalty points for (and a promo/gift-card
  // balance stays spent on, and stock stays decremented for) an order that
  // was never actually fulfilled. Only fires on the transition INTO
  // cancelled, and only once per order (loyaltyReverted guards against a
  // later cancelled → active → cancelled toggle re-firing; the name predates
  // gift-card/promo/stock reversal being added to this same guarded block).
  if (status === 'cancelled' && existing.status !== 'cancelled' && !existing.loyaltyReverted) {
    if (existing.giftCardAmount > 0 && existing.giftCardCode) await revertGiftCardRedemption(existing.giftCardCode, existing.giftCardAmount);
    if (existing.promoCode) await revertPromoUsage(existing.promoCode);
    // Regression: cancelling an order never gave the units it reserved back
    // to inventory, so a variant that sold out could stay permanently
    // (incorrectly) sold out even after every order for it was cancelled.
    for (const item of fromJson(existing.items, [])) {
      await restoreVariantStock(item.productId, item.size, item.color, item.quantity);
    }
    // A serial already shipped/delivered is permanently retired — it must
    // never appear to belong to two different customers over time. Only a
    // pre-fulfillment cancellation (never got as far as shipping) releases
    // its claimed numbers back to the pool for a future order to receive.
    if (!['shipped', 'delivered'].includes(existing.status)) {
      await releaseEditionsForOrder(existing.id);
    }
    updates.push('loyaltyReverted = 1');
  }

  // Captured before the UPDATE so these reflect an actual transition (not
  // just "the admin saved the same status again"), preventing a duplicate
  // confirmed/shipped/delivered/cancelled/refunded email on a re-save or
  // retried request.
  const justConfirmed = status === 'confirmed' && existing.status !== 'confirmed';
  const justShipped = status === 'shipped' && existing.status !== 'shipped';
  const justDelivered = status === 'delivered' && existing.status !== 'delivered';
  const justCancelled = status === 'cancelled' && existing.status !== 'cancelled';
  const justRefunded = paymentStatus === 'refunded' && existing.paymentStatus !== 'refunded';

  // Start the return window the first time an order becomes Delivered.
  if (status === 'delivered' && existing.status !== 'delivered' && !existing.deliveredAt) {
    updates.push('deliveredAt = CURRENT_TIMESTAMP');
  }

  values.push(orderId);
  await run(`UPDATE orders SET ${updates.join(', ')} WHERE id = ?`, values);

  // UP Society points follow the payment: earned once the order is paid,
  // taken back (and points spent on it returned) once it's cancelled or
  // refunded. Both are idempotent, so re-saving a status is harmless.
  const updated = await get('SELECT status, paymentStatus FROM orders WHERE id = ?', [orderId]);
  if (updated.status === 'cancelled' || updated.paymentStatus === 'refunded') await reverseOrderLoyalty(orderId);
  else if (updated.paymentStatus === 'paid') await awardOrderPoints(orderId);
  const row = await get('SELECT * FROM orders WHERE id = ?', [orderId]);

  // Order status/paymentStatus is already committed above — an email failure
  // here must never undo it or fail this request, so each send is
  // fire-and-forget with its own catch (sendOrderStatusEmail also never
  // throws, but this is defense-in-depth against an unexpected error).
  if (justConfirmed) {
    // An order that already got its full confirmation email at checkout
    // gets a short "confirmed" update; one that never did (e.g. an admin
    // confirming a payment_pending order) gets the full confirmation.
    if (existing.confirmationEmailSentAt) {
      sendOrderStatusEmail({ order: row, event: 'confirmed' }).catch(() => {});
    } else {
      sendConfirmationForOrder(orderId);
    }
  }
  if (justShipped) sendOrderStatusEmail({ order: row, event: 'shipped' }).catch(() => {});
  if (justDelivered) sendOrderStatusEmail({ order: row, event: 'delivered' }).catch(() => {});
  if (justCancelled) sendOrderStatusEmail({ order: row, event: 'cancelled' }).catch(() => {});
  if (justRefunded) sendOrderStatusEmail({ order: row, event: 'refunded' }).catch(() => {});

  return { status: 200, body: { order: await serializeOrderSingle(row) } };
}
