// Builds the SRC `print` request (mode 2, goods) for a paid order. Pure:
// no DB, no network — unit-tested in tests/unit/hdm-receipt.test.mjs.
//
// Money: orders are priced in USD internally, but the customer is charged a
// fixed AMD amount (ArCa/Idram: round(totalUsd × 390)). The receipt must add
// up to EXACTLY that charged amount, so every line is computed in integer
// luma (0.01 AMD) and the charged total is split across the lines by
// largest remainder — no floating point drift, no rounding mismatch that SRC
// would reject (152 PAID_AMOUNT_LESS_THAN_TOTAL / 167 CARD_AMOUNT_EXCEEDED_TOTAL).
//
// Anything the business has not confirmed blocks the receipt with a reason
// instead of being guessed (see config.mjs).
import { RATES } from '../../src/data/currency.js';
import { missingReceiptSettings } from './config.mjs';

const toLuma = (amd) => Math.round(Number(amd) * 100);
const fromLuma = (luma) => Number((luma / 100).toFixed(2));
const cut = (text, max) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// Splits `total` (integer) proportionally to `weights` (non-negative), so
// the parts are integers that sum to exactly `total`.
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum);
  const parts = raw.map(Math.floor);
  let rest = total - parts.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (let k = 0; rest > 0; k = (k + 1) % order.length, rest -= 1) parts[order[k][1]] += 1;
  return parts;
}

export function buildSaleReceipt({ order, amountAmd, config }) {
  const reasons = [...missingReceiptSettings(config)];
  const items = Array.isArray(order.items) ? order.items : [];
  const subtotal = Number(order.subtotal) || 0;
  const shipping = Number(order.shipping) || 0;
  const promo = Number(order.discountAmount) || 0;
  const points = Number(order.loyaltyDiscount) || 0;
  const giftCard = Number(order.giftCardAmount) || 0;
  const total = Number(order.total) || 0;
  const chargedLuma = toLuma(amountAmd);

  if (!(chargedLuma > 0) || !Number.isInteger(chargedLuma)) reasons.push('No valid charged AMD amount is recorded for this payment.');
  if (!items.length) reasons.push('The order has no items.');
  if (giftCard > 0) reasons.push('A gift card was used: gift card sales/redemptions need prepayment receipts (mode 3 / prePaymentAmount), which are not configured.');
  if (shipping > 0 && !config.shippingAdgCode) reasons.push('The order has a delivery charge: set HDM_SHIPPING_ADG_CODE (and optionally HDM_SHIPPING_GOOD_CODE/NAME/DEPARTMENT) to put delivery on the receipt.');
  if ((promo > 0 || points > 0) && config.discountMode !== 'line_total') reasons.push('The order has a discount (promo code or UP Society points): set HDM_DISCOUNT_MODE=line_total once confirmed with your accountant.');
  const expected = Math.max(0, subtotal - promo) + shipping - giftCard - points;
  if (Math.abs(expected - total) > 0.011) reasons.push(`Order amounts do not add up (expected total ${expected.toFixed(2)}, stored ${total.toFixed(2)}).`);
  for (const item of items) {
    if (!(Number(item.quantity) > 0) || !Number.isInteger(Number(item.quantity))) reasons.push(`Invalid quantity for ${item.name}.`);
    if (!(Number(item.lineTotal) > 0)) reasons.push(`Invalid price for ${item.name}.`);
  }
  if (reasons.length) return { ok: false, reasons };

  // Lines in USD: items, then delivery. Reductions (promo + points) come off
  // the item lines proportionally; whatever is left (points can also cover
  // delivery) comes off the delivery line.
  const lines = items.map((item) => ({
    kind: 'item',
    item,
    grossUsd: Number(item.lineTotal),
    quantity: Number(item.quantity),
    unitUsd: Number(item.unitPrice) || Number(item.lineTotal) / Number(item.quantity),
  }));
  if (shipping > 0) lines.push({ kind: 'shipping', grossUsd: shipping, quantity: 1, unitUsd: shipping });

  const grossCents = lines.map((l) => Math.round(l.grossUsd * 100));
  const itemCents = grossCents.slice(0, items.length);
  const reductionCents = Math.round((promo + points) * 100);
  const itemReduction = Math.min(reductionCents, itemCents.reduce((a, b) => a + b, 0));
  const perItem = allocate(itemReduction, itemCents);
  const reduction = lines.map((_, i) => (i < items.length ? perItem[i] : 0));
  if (shipping > 0) reduction[lines.length - 1] = Math.min(reductionCents - itemReduction, grossCents[lines.length - 1]);
  const netCents = grossCents.map((g, i) => g - reduction[i]);

  // The charged AMD, split over the lines by their net USD value.
  const netLuma = allocate(chargedLuma, netCents);
  const rate = chargedLuma / Math.max(1, netCents.reduce((a, b) => a + b, 0)); // luma per US cent

  const out = [];
  lines.forEach((line, i) => {
    const base = line.kind === 'item'
      ? {
          adgCode: config.adgCode,
          dep: config.department,
          goodCode: cut(line.item.productId, 50),
          goodName: cut([line.item.name, line.item.size].filter(Boolean).join(' '), 50),
          unit: config.unit,
        }
      : {
          adgCode: config.shippingAdgCode,
          dep: config.shippingDepartment || config.department,
          goodCode: cut(config.shippingGoodCode, 50),
          goodName: cut(config.shippingGoodName, 50),
          unit: config.unit,
        };
    const q = line.quantity;
    const n = netLuma[i];
    if (reduction[i] > 0) {
      // Discounted line: the real pre-discount unit price, discount type 4
      // (TOTAL: price × quantity − discount).
      let price = Math.round(line.unitUsd * 100 * rate);
      if (price * q < n) price = Math.ceil(n / q);
      const discount = price * q - n;
      out.push({ ...base, quantity: q, price: fromLuma(price), ...(discount > 0 ? { discount: fromLuma(discount), discountType: 4 } : {}) });
      return;
    }
    // Undiscounted line: price × quantity must equal the line's share
    // exactly. If it doesn't divide evenly, split into two lines that differ
    // by 0.01 AMD per unit instead of inventing a discount.
    const unit = Math.floor(n / q);
    const extra = n - unit * q;
    if (extra === 0) out.push({ ...base, quantity: q, price: fromLuma(unit) });
    else {
      if (q - extra > 0) out.push({ ...base, quantity: q - extra, price: fromLuma(unit) });
      out.push({ ...base, quantity: extra, price: fromLuma(unit + 1) });
    }
  });

  // Final guard: the receipt total must equal the charged amount to the luma.
  const receiptLuma = out.reduce((sum, l) => sum + toLuma(l.price) * l.quantity - toLuma(l.discount || 0), 0);
  if (receiptLuma !== chargedLuma) {
    return { ok: false, reasons: [`Internal rounding check failed (${receiptLuma} ≠ ${chargedLuma} luma).`] };
  }
  if (out.some((l) => !(l.price > 0))) return { ok: false, reasons: ['A receipt line would have a zero price.'] };

  return {
    ok: true,
    payload: {
      cashAmount: 0,
      cardAmount: fromLuma(chargedLuma),
      partialAmount: 0,
      prePaymentAmount: 0,
      cashierId: config.cashierId,
      mode: 2,
      partnerTin: null,
      items: out,
    },
    total: fromLuma(chargedLuma),
    usdToAmd: RATES.AMD,
  };
}
