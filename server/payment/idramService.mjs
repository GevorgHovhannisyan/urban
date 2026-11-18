// Idram checkout orchestration. Same rule as the Stripe flow in
// paymentService.mjs: the order is NOT created when the customer starts
// paying — only a `pending_checkouts` row (type 'idram') holding the
// server-validated draft. A real order is committed only from Idram's signed
// payment confirmation (handleIdramResult → confirm), never from the browser
// landing on the success page, which anyone could open by hand.
//
// The pending row's id IS the EDP_BILL_NO sent to Idram.
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { get, run, toJson, fromJson } from '../db.mjs';
import { validateOrderDraft, completePayment } from '../order-api.mjs';
import * as idram from './providers/idram.mjs';

const PENDING_TYPE = 'idram';
const PROVIDER = 'idram';
const clean = (value, max = 100) => String(value ?? '').trim().slice(0, max);

export function isIdramConfigured() {
  return idram.isConfigured();
}

export function describeIdramConfig() {
  return idram.describeConfig();
}

// 12-digit numeric bill number — numeric like Idram's own example, short
// enough for any accounting system, and not sequential.
function newBillNo() {
  return String(randomInt(100000000000, 1000000000000));
}

async function loadPending(billNo) {
  if (!/^\d{6,20}$/.test(billNo)) return null;
  return get('SELECT * FROM pending_checkouts WHERE id = ? AND type = ?', [billNo, PENDING_TYPE]);
}

function sameToken(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

// POST /api/checkout/idram — validates the order exactly like the card flow,
// stores it as a pending bill, and returns the hidden form fields the browser
// posts to Idram. Prices are always recomputed here; nothing about the amount
// is taken from the client.
export async function createIdramPayment(payload = {}) {
  if (!idram.isConfigured()) {
    return { status: 503, body: { error: 'Idram payment is not available right now. Please choose another payment method.' } };
  }

  const { language, ...orderPayload } = payload;
  const source = { ...orderPayload, paymentMethod: 'idram' };
  const draftResult = await validateOrderDraft(source);
  if (draftResult.error) return { status: 400, body: { error: draftResult.error } };
  const draft = draftResult.value;

  const amount = idram.chargeAmountAmd(draft.total);
  if (!(draft.total > 0) || !(amount > 0)) {
    return { status: 400, body: { error: 'Order total must be greater than zero to pay with Idram.' } };
  }

  // `payment` = what Idram is asked to charge: the real order total in AMD.
  // `source` is the original request, re-run at precheck time so a bill that
  // can no longer be fulfilled is refused before any money moves.
  const payment = {
    provider: PROVIDER,
    amount,
    currency: 'AMD',
    statusToken: randomUUID(),
  };

  let billNo = null;
  for (let attempt = 0; attempt < 5 && !billNo; attempt += 1) {
    const candidate = newBillNo();
    try {
      await run(
        `INSERT INTO pending_checkouts (id, draft, status, type) VALUES (?, ?, 'pending', ?)`,
        [candidate, toJson({ ...draft, payment, source }), PENDING_TYPE],
      );
      billNo = candidate;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
    }
  }
  if (!billNo) return { status: 503, body: { error: 'Could not start Idram payment. Please try again.' } };

  return {
    status: 200,
    body: {
      action: idram.IDRAM_PAYMENT_URL,
      fields: idram.buildPaymentFields({
        billNo,
        amount,
        description: `Urban Phoenix order ${billNo}`,
        language,
      }),
      billNo,
      statusToken: payment.statusToken,
      total: draft.total,
    },
  };
}

const ok = () => ({ status: 200, text: 'OK' });
const refuse = (reason, status = 400) => ({ status, text: reason });

// (a) Precheck — answer "OK" only for a real, still-payable bill for exactly
// the amount we asked for. Anything else makes Idram refuse the payment.
async function precheck(params) {
  const billNo = clean(params.EDP_BILL_NO, 32);
  if (clean(params.EDP_REC_ACCOUNT, 32) !== idram.getRecAccount()) return refuse('Wrong merchant account');

  const pending = await loadPending(billNo);
  if (!pending) return refuse('Unknown bill');
  if (pending.status !== 'pending') return refuse('Bill is not payable');

  const stored = fromJson(pending.draft, null);
  if (!stored?.payment) return refuse('Bill data is corrupted');
  if (!idram.amountsEqual(params.EDP_AMOUNT, stored.payment.amount)) return refuse('Amount mismatch');

  // Still sellable right now? (sold out, limited piece taken, price/promo or
  // points balance changed since checkout started → refuse, nobody is charged)
  const fresh = await validateOrderDraft(stored.source || {});
  if (fresh.error) return refuse(fresh.error);
  if (Math.abs(fresh.value.total - stored.total) >= 0.005) return refuse('Order total changed');

  return ok();
}

// (b) Payment confirmation — money has already moved. Signed by Idram
// (EDP_CHECKSUM); this is the only place an Idram order is ever created.
// Idempotent: a repeated confirmation for the same bill answers "OK" without
// creating a second order (completePayment's idempotency key `idram:<bill>`
// also guards concurrent duplicates).
async function confirm(params) {
  const required = ['EDP_BILL_NO', 'EDP_REC_ACCOUNT', 'EDP_PAYER_ACCOUNT', 'EDP_AMOUNT', 'EDP_TRANS_ID', 'EDP_TRANS_DATE', 'EDP_CHECKSUM'];
  if (required.some((key) => !clean(params[key]))) return refuse('Missing fields');
  if (!idram.verifyChecksum(params)) return refuse('Invalid checksum', 403);
  if (clean(params.EDP_REC_ACCOUNT, 32) !== idram.getRecAccount()) return refuse('Wrong merchant account');

  const billNo = clean(params.EDP_BILL_NO, 32);
  const pending = await loadPending(billNo);
  if (!pending) return refuse('Unknown bill');

  const stored = fromJson(pending.draft, null);
  if (!stored?.payment) return refuse('Bill data is corrupted');
  if (!idram.amountsEqual(params.EDP_AMOUNT, stored.payment.amount)) return refuse('Amount mismatch');
  if (pending.status === 'completed') return ok();

  const transId = clean(params.EDP_TRANS_ID, 64);
  const { payment, source, ...draft } = stored;
  const result = await completePayment(draft, {
    provider: PROVIDER,
    providerTransactionId: transId,
    pendingCheckoutId: billNo,
    // Idram has no test environment — a confirmed bill is real money, so it
    // never gets the admin "sandbox" badge (PAYMENT_ENV is Stripe's setting).
    // testMode only exists on bills started under the old 10 AMD test mode.
    paymentEnv: payment.testMode ? 'sandbox' : 'production',
  });
  if (result.status !== 201) {
    // Not answering "OK" makes Idram email IDRAM_EMAIL / the merchant email,
    // so a paid-but-unfulfillable bill is never silently lost.
    console.error(`[idram] bill ${billNo} paid (trans ${transId}) but the order could not be created: ${result.body?.error || result.status}`);
    return refuse('Order could not be completed', 500);
  }

  await run(`UPDATE pending_checkouts SET status = 'completed', draft = ? WHERE id = ?`, [
    toJson({
      ...stored,
      payment: {
        ...payment,
        transId,
        payerAccount: clean(params.EDP_PAYER_ACCOUNT, 32),
        transDate: clean(params.EDP_TRANS_DATE, 20),
      },
    }),
    billNo,
  ]);
  return ok();
}

// POST /payment/idram-result (RESULT_URL). Idram reads only the plain-text
// body: exactly "OK" means accepted.
export async function handleIdramResult(params = {}) {
  if (!idram.isConfigured()) return refuse('Idram is not configured', 503);
  const isPrecheck = String(params.EDP_PRECHECK || '').toUpperCase() === 'YES';
  try {
    const result = isPrecheck ? await precheck(params) : await confirm(params);
    console.log(`[idram] ${isPrecheck ? 'precheck' : 'confirmation'} bill=${clean(params.EDP_BILL_NO, 32)} amount=${clean(params.EDP_AMOUNT, 20)} → ${result.text}`);
    return result;
  } catch (error) {
    console.error(`[idram] ${isPrecheck ? 'precheck' : 'confirmation'} bill=${clean(params.EDP_BILL_NO, 32)} failed:`, error);
    return refuse('Error', 500);
  }
}

// GET /api/checkout/idram/:billNo/status?token=… — polled by the success page.
// Requires the per-bill token returned when the payment started, so a bill
// number alone (visible in Idram's UI) can't be used to look up the order.
export async function getIdramPaymentStatus(billNo, token) {
  const pending = await loadPending(clean(billNo, 32));
  const stored = pending ? fromJson(pending.draft, null) : null;
  if (!pending || !sameToken(token, stored?.payment?.statusToken)) {
    return { status: 404, body: { error: 'Payment not found.' } };
  }
  if (pending.status !== 'completed') return { status: 200, body: { status: 'pending' } };

  const row = await get('SELECT orderNumber, total FROM orders WHERE idempotencyKey = ?', [`${PROVIDER}:${pending.id}`]);
  return {
    status: 200,
    body: { status: 'succeeded', order: row ? { orderNumber: row.orderNumber, total: Number(row.total) } : null },
  };
}
