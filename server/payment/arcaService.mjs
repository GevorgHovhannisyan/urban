// ArCa card checkout orchestration. Same rule as Idram (idramService.mjs) and
// Stripe (paymentService.mjs): starting a payment creates NO order, only a
// `pending_checkouts` row (type 'arca') holding the server-validated draft.
// A real order is committed only after the server itself has asked ArCa
// (getOrderStatusExtended.do) and ArCa said the order is paid, for exactly
// the amount we registered. The browser landing on the return URL proves
// nothing by itself; anyone could open it by hand.
//
// The pending row's id IS the orderNumber sent to ArCa; ArCa's own orderId
// (mdOrder) is stored in its paymentIntentId column.
//
// Three paths can confirm a payment, and all of them go through syncWithArca():
//   - the return URL (/payment/arca/return), right after paying;
//   - the status endpoint the success page polls;
//   - reconcilePendingArcaPayments(), every few minutes, for customers who
//     paid but closed the tab before coming back.
import { randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { get, all, run, toJson, fromJson } from '../db.mjs';
import { validateOrderDraft, completePayment } from '../order-api.mjs';
import * as arca from './providers/arca.mjs';

const PENDING_TYPE = 'arca';
const PROVIDER = 'arca';
const clean = (value, max = 100) => String(value ?? '').trim().slice(0, max);

export function isArcaConfigured() {
  return arca.isConfigured();
}

export function describeArcaConfig() {
  return arca.describeConfig();
}

// 12-digit numeric order number — unique per merchant, not sequential.
function newOrderNumber() {
  return String(randomInt(100000000000, 1000000000000));
}

async function loadPending(orderNumber) {
  if (!/^\d{6,20}$/.test(orderNumber)) return null;
  return get('SELECT * FROM pending_checkouts WHERE id = ? AND type = ?', [orderNumber, PENDING_TYPE]);
}

async function loadPendingByArcaOrderId(orderId) {
  if (!/^[0-9A-Za-z-]{8,64}$/.test(orderId)) return null;
  return get('SELECT * FROM pending_checkouts WHERE paymentIntentId = ? AND type = ?', [orderId, PENDING_TYPE]);
}

function sameToken(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

// POST /api/checkout/arca — validates the order exactly like the other
// payment flows, stores it as a pending checkout, registers it with ArCa and
// returns ArCa's payment page URL. Prices are always recomputed here; nothing
// about the amount is taken from the client.
export async function createArcaPayment(payload = {}, { returnUrl } = {}) {
  if (!arca.isConfigured()) {
    return { status: 503, body: { error: 'Card payment is not available right now. Please choose another payment method.' } };
  }

  const { language, ...orderPayload } = payload;
  const draftResult = await validateOrderDraft({ ...orderPayload, paymentMethod: 'card' });
  if (draftResult.error) return { status: 400, body: { error: draftResult.error } };
  const draft = draftResult.value;

  const amount = arca.chargeAmountAmd(draft.total);
  if (!(draft.total > 0) || !(amount > 0)) {
    return { status: 400, body: { error: 'Order total must be greater than zero to pay by card.' } };
  }

  // `payment` = what ArCa is asked to charge: the real order total in AMD.
  const payment = {
    provider: PROVIDER,
    amount,
    currency: 'AMD',
    testGateway: arca.isTestGateway(),
    statusToken: randomUUID(),
  };

  let orderNumber = null;
  for (let attempt = 0; attempt < 5 && !orderNumber; attempt += 1) {
    const candidate = newOrderNumber();
    try {
      await run(
        `INSERT INTO pending_checkouts (id, draft, status, type) VALUES (?, ?, 'pending', ?)`,
        [candidate, toJson({ ...draft, payment }), PENDING_TYPE],
      );
      orderNumber = candidate;
    } catch (error) {
      if (error?.code !== 'ER_DUP_ENTRY') throw error;
    }
  }
  if (!orderNumber) return { status: 503, body: { error: 'Could not start card checkout. Please try again.' } };

  let registered;
  try {
    registered = await arca.registerOrder({
      orderNumber,
      amountAmd: amount,
      returnUrl,
      description: `Urban Phoenix order ${orderNumber}`,
      language,
    });
  } catch (error) {
    console.error(`[arca] register order ${orderNumber} failed: ${error.message}`);
    await run(`UPDATE pending_checkouts SET status = 'expired' WHERE id = ?`, [orderNumber]);
    return { status: 502, body: { error: 'Could not start card checkout. Please try again.' } };
  }

  await run('UPDATE pending_checkouts SET paymentIntentId = ? WHERE id = ?', [registered.orderId, orderNumber]);

  return {
    status: 200,
    body: {
      formUrl: registered.formUrl,
      orderNumber,
      statusToken: payment.statusToken,
      total: draft.total,
    },
  };
}

// Asks ArCa for the real state of a pending checkout and acts on it:
//   'succeeded'  — paid; the order exists (created now or earlier)
//   'failed'     — declined / reversed / refunded, or not payable
//   'unpaid'     — registered at ArCa but nothing paid (e.g. cancelled)
//   'processing' — anything else (unknown status, ArCa unreachable, order
//                  could not be saved yet); checked again later
async function syncWithArca(pendingId) {
  const pending = await loadPending(pendingId);
  if (!pending) return 'failed';
  if (pending.status === 'completed') return 'succeeded';
  if (pending.status !== 'pending') return 'failed';

  const stored = fromJson(pending.draft, null);
  if (!stored?.payment || !pending.paymentIntentId) return 'failed';

  const status = await arca.getOrderStatus(pending.paymentIntentId);
  if (status.orderNumber && status.orderNumber !== pending.id) {
    console.error(`[arca] order ${pending.id}: ArCa reports orderNumber ${status.orderNumber} for orderId ${pending.paymentIntentId}`);
    return 'failed';
  }

  if (arca.isPaid(status)) {
    if (status.amount !== arca.toMinorUnits(stored.payment.amount) || !arca.isAmd(status.currency)) {
      // Can't happen with an amount we registered ourselves — never turn it
      // into an order automatically; it needs a human look.
      console.error(`[arca] order ${pending.id} PAID with unexpected amount ${status.amount} (currency ${status.currency}); expected ${arca.toMinorUnits(stored.payment.amount)} AMD minor units — NOT creating the order, check it manually`);
      return 'failed';
    }

    const { payment, ...draft } = stored;
    const result = await completePayment(draft, {
      provider: PROVIDER,
      providerTransactionId: pending.paymentIntentId,
      pendingCheckoutId: pending.id,
      // Real money, so no admin "sandbox" badge (PAYMENT_ENV is Stripe's
      // setting) — unless it ran on ArCa's public test gateway. testMode only
      // exists on payments started under the old 10 AMD test mode.
      paymentEnv: payment.testMode || payment.testGateway ? 'sandbox' : 'production',
      // Verified just above: ArCa says paid, for exactly this AMD amount.
      paidAmount: payment.amount,
      paidCurrency: 'AMD',
    });
    if (result.status !== 201) {
      console.error(`[arca] order ${pending.id} paid (ArCa orderId ${pending.paymentIntentId}) but the order could not be created: ${result.body?.error || result.status}`);
      return 'processing';
    }

    await run(`UPDATE pending_checkouts SET status = 'completed', draft = ? WHERE id = ?`, [
      toJson({ ...stored, payment: { ...payment, approvalCode: status.approvalCode, paidAt: new Date().toISOString() } }),
      pending.id,
    ]);
    console.log(`[arca] order ${pending.id} paid (ArCa orderId ${pending.paymentIntentId}) → order ${result.body?.orderNumber || ''}`);
    return 'succeeded';
  }

  // The bank's reason, e.g. "actionCode -2006: 3-D Secure: issuing bank
  // rejected authentication" — read it with `journalctl -u urban-phoenix`.
  const reason = `orderStatus ${status.orderStatus}, ${arca.describeActionCode(status.actionCode)}${status.actionCodeDescription ? ` (${status.actionCodeDescription})` : ''}`;
  if (arca.isFailed(status)) {
    await run(`UPDATE pending_checkouts SET status = 'expired' WHERE id = ? AND status = 'pending'`, [pending.id]);
    console.log(`[arca] order ${pending.id} declined — ${reason}`);
    return 'failed';
  }
  if (arca.isUnpaid(status)) {
    console.log(`[arca] order ${pending.id} not paid — ${reason}`);
    return 'unpaid';
  }
  console.log(`[arca] order ${pending.id} still processing — ${reason}`);
  return 'processing';
}

// The return redirect, the polling page and the reconciliation sweep can all
// check the same payment at the same moment — run one check at a time per
// order (completePayment's idempotency key is the hard guard either way).
const inFlight = new Map();
function syncOnce(pendingId) {
  if (inFlight.has(pendingId)) return inFlight.get(pendingId);
  const promise = syncWithArca(pendingId).finally(() => inFlight.delete(pendingId));
  inFlight.set(pendingId, promise);
  return promise;
}

// GET /payment/arca/return?orderId=… (returnUrl and failUrl). Answers the
// storefront page to send the customer to; the success page then polls the
// status endpoint, which only says "paid" once the order really exists.
export async function handleArcaReturn(query = {}) {
  const orderId = clean(query.orderId || query.mdOrder, 64);
  const pending = await loadPendingByArcaOrderId(orderId);
  if (!pending) return { location: '/payment/fail?via=arca' };

  let outcome;
  try {
    outcome = await syncOnce(pending.id);
  } catch (error) {
    console.error(`[arca] return for order ${pending.id} could not be checked: ${error.message}`);
    outcome = 'processing'; // the success page keeps checking
  }
  const page = outcome === 'succeeded' || outcome === 'processing' ? 'success' : 'fail';
  return { location: `/payment/${page}?via=arca&bill=${pending.id}` };
}

// GET /api/checkout/arca/:orderNumber/status?token=… — polled by the success
// page. Requires the per-payment token returned when the payment started.
export async function getArcaPaymentStatus(orderNumber, token) {
  const pending = await loadPending(clean(orderNumber, 32));
  const stored = pending ? fromJson(pending.draft, null) : null;
  if (!pending || !sameToken(token, stored?.payment?.statusToken)) {
    return { status: 404, body: { error: 'Payment not found.' } };
  }

  let outcome;
  try {
    outcome = await syncOnce(pending.id);
  } catch (error) {
    console.error(`[arca] status check for order ${pending.id} failed: ${error.message}`);
    outcome = 'processing';
  }

  if (outcome === 'failed') return { status: 200, body: { status: 'failed' } };
  if (outcome !== 'succeeded') return { status: 200, body: { status: 'pending' } };

  const row = await get('SELECT orderNumber, total FROM orders WHERE idempotencyKey = ?', [`${PROVIDER}:${pending.id}`]);
  return {
    status: 200,
    body: { status: 'succeeded', order: row ? { orderNumber: row.orderNumber, total: Number(row.total) } : null },
  };
}

// Safety net for a customer who paid and closed the tab before ArCa could
// send them back: checks recent unfinished card payments with ArCa and
// creates the order for any that were paid. Called on a timer by server.mjs.
export async function reconcilePendingArcaPayments({ minAgeSeconds = 120, maxAgeHours = 3, limit = 50 } = {}) {
  if (!arca.isConfigured()) return { checked: 0, succeeded: 0 };
  const rows = await all(
    `SELECT id FROM pending_checkouts
     WHERE type = ? AND status = 'pending' AND paymentIntentId IS NOT NULL
       AND createdAt <= NOW() - INTERVAL ? SECOND
       AND createdAt >= NOW() - INTERVAL ? HOUR
     ORDER BY createdAt ASC
     LIMIT ${Math.max(1, Math.min(500, Math.floor(Number(limit) || 50)))}`,
    [PENDING_TYPE, Math.max(0, Math.floor(minAgeSeconds)), Math.max(1, Math.floor(maxAgeHours))],
  );
  let succeeded = 0;
  for (const row of rows) {
    try {
      if ((await syncOnce(row.id)) === 'succeeded') succeeded += 1;
    } catch (error) {
      console.error(`[arca] reconcile order ${row.id} failed: ${error.message}`);
    }
  }
  return { checked: rows.length, succeeded };
}
