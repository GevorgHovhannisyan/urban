// Unit tests for the fiscal receipt builder (server/hdm/receipt.mjs).
// Pure — no database, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSaleReceipt, allocate } from '../../server/hdm/receipt.mjs';

const CONFIG = {
  department: 1, adgCode: '6110', cashierId: 1, unit: 'հատ',
  shippingAdgCode: null, shippingGoodCode: 'DELIVERY', shippingGoodName: 'Առաքում', shippingDepartment: null,
  discountMode: null,
};
const item = (productId, unitPrice, quantity, name = 'Hoodie', size = 'L') => ({ productId, name, size, unitPrice, quantity, lineTotal: Number((unitPrice * quantity).toFixed(2)) });
const order = (items, extra = {}) => {
  const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
  const o = { items, subtotal, shipping: 0, discountAmount: 0, loyaltyDiscount: 0, giftCardAmount: 0, ...extra };
  o.total = Number((Math.max(0, o.subtotal - o.discountAmount) + o.shipping - o.giftCardAmount - o.loyaltyDiscount).toFixed(2));
  return o;
};
const luma = (v) => Math.round(v * 100);
const receiptTotalLuma = (payload) => payload.items.reduce((s, l) => s + luma(l.price) * l.quantity - luma(l.discount || 0), 0);

test('allocate splits an integer exactly and proportionally', () => {
  assert.deepEqual(allocate(10, [1, 1, 1]), [4, 3, 3]);
  assert.equal(allocate(1234567, [3, 7, 11, 0]).reduce((a, b) => a + b, 0), 1234567);
  assert.deepEqual(allocate(5, [0, 0]), [0, 0]);
});

test('single item: one goods line, price equals the charged AMD, paid by card', () => {
  const o = order([item('freedom-to-become', 120, 1)]);
  const r = buildSaleReceipt({ order: o, amountAmd: 46800, config: CONFIG });
  assert.equal(r.ok, true, r.reasons?.join(' '));
  assert.equal(r.payload.mode, 2);
  assert.equal(r.payload.cardAmount, 46800);
  assert.equal(r.payload.cashAmount, 0);
  assert.equal(r.payload.prePaymentAmount, 0);
  assert.equal(r.payload.partnerTin, null);
  assert.equal(r.payload.cashierId, 1);
  assert.deepEqual(r.payload.items, [{ adgCode: '6110', dep: 1, goodCode: 'freedom-to-become', goodName: 'Hoodie L', unit: 'հատ', quantity: 1, price: 46800 }]);
});

test('quantity that does not divide the amount evenly is split into two lines — never a fake discount', () => {
  const o = order([item('tee', 33.33, 3)]);
  const r = buildSaleReceipt({ order: o, amountAmd: 38996, config: CONFIG });
  assert.equal(r.ok, true);
  assert.equal(receiptTotalLuma(r.payload), luma(38996));
  assert.ok(r.payload.items.every((l) => !('discount' in l)));
  assert.equal(r.payload.items.reduce((s, l) => s + l.quantity, 0), 3);
});

test('delivery charge blocks until delivery is configured, then becomes its own line', () => {
  const o = order([item('hoodie', 100, 1)], { shipping: 15 });
  const blocked = buildSaleReceipt({ order: o, amountAmd: 44850, config: CONFIG });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reasons.join(' '), /HDM_SHIPPING_ADG_CODE/);

  const r = buildSaleReceipt({ order: o, amountAmd: 44850, config: { ...CONFIG, shippingAdgCode: '4923' } });
  assert.equal(r.ok, true);
  const ship = r.payload.items.find((l) => l.goodCode === 'DELIVERY');
  assert.equal(ship.adgCode, '4923');
  assert.equal(ship.goodName, 'Առաքում');
  assert.equal(receiptTotalLuma(r.payload), luma(44850));
});

test('promo/points discounts block until HDM_DISCOUNT_MODE=line_total, then use discountType 4', () => {
  const o = order([item('a', 100, 1), item('b', 50, 2)], { discountAmount: 20, loyaltyDiscount: 10 });
  assert.equal(o.total, 170);
  const blocked = buildSaleReceipt({ order: o, amountAmd: 66300, config: CONFIG });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reasons.join(' '), /HDM_DISCOUNT_MODE/);

  const r = buildSaleReceipt({ order: o, amountAmd: 66300, config: { ...CONFIG, discountMode: 'line_total' } });
  assert.equal(r.ok, true, r.reasons?.join(' '));
  assert.equal(receiptTotalLuma(r.payload), luma(66300));
  for (const line of r.payload.items) {
    if (line.discount) {
      assert.equal(line.discountType, 4);
      assert.ok(line.discount > 0);
    }
  }
  assert.ok(r.payload.items.some((l) => l.discount > 0));
});

test('gift card usage always blocks (needs prepayment receipts)', () => {
  const o = order([item('a', 100, 1)], { giftCardAmount: 25 });
  const r = buildSaleReceipt({ order: o, amountAmd: 29250, config: { ...CONFIG, discountMode: 'line_total' } });
  assert.equal(r.ok, false);
  assert.match(r.reasons.join(' '), /gift card/i);
});

test('missing business settings are listed, not guessed', () => {
  const r = buildSaleReceipt({ order: order([item('a', 10, 1)]), amountAmd: 3900, config: { ...CONFIG, department: null, adgCode: null, cashierId: null, unit: null } });
  assert.equal(r.ok, false);
  const text = r.reasons.join(' ');
  for (const key of ['HDM_DEPARTMENT', 'HDM_ADG_CODE', 'HDM_CASHIER_ID', 'HDM_UNIT']) assert.match(text, new RegExp(key));
});

test('inconsistent stored totals block the receipt', () => {
  const o = { ...order([item('a', 10, 1)]), total: 99 };
  assert.equal(buildSaleReceipt({ order: o, amountAmd: 3900, config: CONFIG }).ok, false);
});

test('randomised: every receipt adds up to exactly the charged amount, with positive prices', () => {
  const config = { ...CONFIG, shippingAdgCode: '4923', discountMode: 'line_total' };
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = 0; n < 500; n += 1) {
    const items = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, i) => item(`p${i}`, Number((5 + rnd() * 200).toFixed(2)), 1 + Math.floor(rnd() * 4)));
    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const extra = {
      shipping: rnd() < 0.4 ? Number((rnd() * 20).toFixed(2)) : 0,
      discountAmount: rnd() < 0.4 ? Number((rnd() * subtotal * 0.5).toFixed(2)) : 0,
      loyaltyDiscount: rnd() < 0.3 ? 5 : 0,
    };
    const o = order(items, extra);
    if (!(o.total > 0)) continue;
    const amountAmd = Math.round(o.total * 390);
    const r = buildSaleReceipt({ order: o, amountAmd, config });
    assert.equal(r.ok, true, `case ${n}: ${r.reasons?.join(' ')}`);
    assert.equal(receiptTotalLuma(r.payload), luma(amountAmd), `case ${n}`);
    assert.equal(r.payload.cardAmount, amountAmd);
    for (const l of r.payload.items) {
      assert.ok(l.price > 0, `case ${n}: positive price`);
      assert.ok(Number.isInteger(l.quantity) && l.quantity > 0);
      assert.ok(!l.discount || l.discount > 0);
      assert.ok(Number.isInteger(Math.round(l.price * 100)) && Math.abs(l.price * 100 - Math.round(l.price * 100)) < 1e-6, 'max 2 decimals');
    }
  }
});
