// Fiscal receipts (ՀԴՄ) for verified online payments — durable outbox,
// worker, crash recovery, reconciliation, receipt email and access control.
//
// Lifecycle of an hdm_receipts row (status):
//   pending    — waiting to be sent (also after a "not sent" network error,
//                with backoff in nextAttemptAt)
//   processing — claimed by a worker (lockedBy/lockedUntil). `sentAt` is set
//                and COMMITTED right before the print request goes out —
//                that is the dispatch marker crash recovery relies on
//   issued     — SRC returned the receipt; identifiers/QR stored
//   failed     — SRC rejected the request (definitely no receipt). Needs a
//                fix and an admin "retry"
//   unknown    — the request went out but no reliable answer came back, or
//                the server stopped mid-request. A receipt MAY exist: never
//                resent automatically — reconciliation (printCopy over the
//                receipt-number sequence) or an admin decides
//   blocked    — missing/unconfirmed business settings; re-checked
//                periodically and sent once the settings exist
//
// Payment status (orders.paymentStatus), fiscal status (this table) and
// email delivery (orders.confirmationEmail*, hdm_receipts.email*) are
// tracked separately and never block each other: a fiscal problem never
// undoes a paid order.
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { all, get, run, fromJson, toJson } from '../db.mjs';
import { getHdmConfig, missingConnectionSettings } from './config.mjs';
import * as src from './srcClient.mjs';
import { buildSaleReceipt } from './receipt.mjs';
import { buildInvoicePdf } from './invoicePdf.mjs';
import { getPublicUrl, sendFiscalReceiptEmail } from '../mailer.mjs';

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;
const LOCK_MS = 3 * 60 * 1000;
const RECONCILE_MIN_AGE_MS = 2 * 60 * 1000; // give SRC time before looking
const CONCLUDE_NOT_CREATED_AGE_MS = 10 * 60 * 1000;
const MATCH_WINDOW = { beforeMs: 2 * 60 * 1000, afterMs: 30 * 60 * 1000 };
const EMAIL_MAX_ATTEMPTS = 8;
const EMAIL_RETRY_WINDOW_HOURS = 72;
const RECEIPT_DOES_NOT_EXIST = 176;

const sqlTime = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const parseSqlTime = (value) => (value ? new Date(`${String(value).replace(' ', 'T')}Z`).getTime() : 0);
const clip = (text, max = 2000) => String(text ?? '').slice(0, max);
const amountEq = (a, b) => Math.round(Number(a) * 100) === Math.round(Number(b) * 100);

// One SRC write at a time in this process: keeps receipt numbers in the
// order we sent them, and lets reconciliation reason about the sequence
// without a print racing it. (The DB claim is what protects against a
// second process.)
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

// ---------- creating tasks ----------
export function shouldFiscalize({ provider, paymentEnv }) {
  const config = getHdmConfig();
  return config.enabled && paymentEnv === 'production' && config.providers.includes(String(provider || '').toLowerCase());
}

// Called inside the order's own transaction (order-api.mjs commitOrder), so
// the paid order and its receipt task are committed together or not at all.
export async function insertSaleTask(tx, { orderId, amount, currency, provider, providerTransactionId }) {
  await tx.run(
    `INSERT INTO hdm_receipts (id, orderId, kind, status, crn, amount, currency, paymentProvider, providerTransactionId, accessToken)
     VALUES (?, ?, 'sale', 'pending', ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), orderId, getHdmConfig().crn || null, amount, currency, provider, providerTransactionId || null, randomBytes(24).toString('hex')],
  );
}

// Manual backfill for an order paid before HDM was switched on (CLI only).
// Reuses an existing task — never creates a second sale receipt.
export async function enqueueExistingOrder(orderNumber) {
  const order = await get('SELECT * FROM orders WHERE orderNumber = ?', [orderNumber]);
  if (!order) return { ok: false, error: 'Order not found.' };
  const existing = await get(`SELECT * FROM hdm_receipts WHERE orderId = ? AND kind = 'sale'`, [order.id]);
  if (existing) return { ok: true, existing: true, status: existing.status };
  if (order.paymentStatus !== 'paid') return { ok: false, error: 'Only paid orders can get a receipt.' };
  if (!(Number(order.paidAmount) > 0) || order.paidCurrency !== 'AMD') {
    return { ok: false, error: 'This order has no recorded AMD payment amount (it was paid before amounts were stored). Issue its receipt manually.' };
  }
  try {
    await insertSaleTask({ run }, { orderId: order.id, amount: order.paidAmount, currency: 'AMD', provider: order.paymentProvider, providerTransactionId: order.providerTransactionId });
  } catch (error) {
    if (error?.code !== 'ER_DUP_ENTRY') throw error;
  }
  kickHdmWorker();
  return { ok: true, existing: false };
}

// ---------- worker ----------
let kickScheduled = false;
export function kickHdmWorker() {
  if (kickScheduled) return;
  kickScheduled = true;
  setImmediate(() => {
    kickScheduled = false;
    processDueTasks().catch((error) => console.error('[hdm] worker run failed:', error));
  });
}

// A worker that died mid-task leaves a stale lock. Before the request was
// dispatched (sentAt NULL) it is safe to retry; after, it is UNKNOWN.
export async function recoverStaleTasks() {
  const now = sqlTime();
  const retry = await run(
    `UPDATE hdm_receipts SET status = 'pending', lockedBy = NULL, lockedUntil = NULL
      WHERE status = 'processing' AND lockedUntil < ? AND sentAt IS NULL`, [now]);
  const unknown = await run(
    `UPDATE hdm_receipts SET status = 'unknown', lockedBy = NULL, lockedUntil = NULL,
        lastError = 'The server stopped while waiting for SRC — the receipt may or may not exist. Reconciliation will check.'
      WHERE status = 'processing' AND lockedUntil < ? AND sentAt IS NOT NULL`, [now]);
  if (retry.affectedRows || unknown.affectedRows) {
    console.warn(`[hdm] recovered stale tasks: ${retry.affectedRows} back to pending (never sent), ${unknown.affectedRows} marked unknown (sent, no answer)`);
  }
}

export function processDueTasks() {
  return serial(async () => {
    const config = getHdmConfig();
    if (!config.enabled) return { processed: 0 };
    await recoverStaleTasks();
    const due = await all(
      `SELECT id FROM hdm_receipts WHERE status IN ('pending', 'blocked') AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)
        ORDER BY createdAt ASC LIMIT 20`, [sqlTime()]);
    let processed = 0;
    for (const { id } of due) {
      if (await processTask(id)) processed += 1;
    }
    return { processed };
  });
}

function backoffMs(attempts) {
  return Math.min(60, 2 ** Math.max(0, attempts - 1)) * 60 * 1000; // 1,2,4…60 min
}

async function processTask(id) {
  const claim = await run(
    `UPDATE hdm_receipts SET status = 'processing', lockedBy = ?, lockedUntil = ?, attempts = attempts + 1
      WHERE id = ? AND status IN ('pending', 'blocked') AND (nextAttemptAt IS NULL OR nextAttemptAt <= ?)`,
    [WORKER_ID, sqlTime(Date.now() + LOCK_MS), id, sqlTime()]);
  if (!claim.affectedRows) return false;

  const task = await get('SELECT * FROM hdm_receipts WHERE id = ?', [id]);
  const order = await get('SELECT * FROM orders WHERE id = ?', [task.orderId]);
  const release = (status, fields = {}) => {
    const sets = ['status = ?', 'lockedBy = NULL', 'lockedUntil = NULL', ...Object.keys(fields).map((k) => `${k} = ?`)];
    return run(`UPDATE hdm_receipts SET ${sets.join(', ')} WHERE id = ? AND lockedBy = ?`, [status, ...Object.values(fields), id, WORKER_ID]);
  };

  const config = getHdmConfig();
  if (!order) {
    await release('failed', { lastError: 'Order not found.' });
    return true;
  }
  if (order.status === 'cancelled' || order.paymentStatus === 'refunded') {
    await release('failed', { lastError: `Order is ${order.status}/${order.paymentStatus} — no sale receipt issued.` });
    return true;
  }
  const connectionMissing = missingConnectionSettings(config);
  const built = buildSaleReceipt({ order: { ...order, items: fromJson(order.items, []) }, amountAmd: task.amount, config });
  if (connectionMissing.length || !built.ok) {
    const reasons = [...connectionMissing.map((m) => `Missing ${m}`), ...(built.ok ? [] : built.reasons)];
    await release('blocked', { lastError: clip(reasons.join(' ')), nextAttemptAt: sqlTime(Date.now() + 10 * 60 * 1000) });
    return true;
  }
  try {
    src.prepare(); // loads the certificate bundle — fails here, before anything is sent
  } catch (error) {
    await release('blocked', { lastError: clip(error.message), nextAttemptAt: sqlTime(Date.now() + 10 * 60 * 1000) });
    return true;
  }

  // Dispatch marker, committed BEFORE the request leaves this process.
  await run('UPDATE hdm_receipts SET sentAt = ?, requestJson = ?, crn = ?, lastError = NULL WHERE id = ? AND lockedBy = ?',
    [sqlTime(), toJson(built.payload), config.crn, id, WORKER_ID]);

  let res;
  try {
    res = await src.print(built.payload);
  } catch (error) {
    // Anything thrown after the marker: be conservative.
    console.error(`[hdm] order ${order.orderNumber}: print threw after dispatch:`, error);
    await release('unknown', { lastError: clip(`Unexpected error after sending: ${error.message}`) });
    return true;
  }

  if (res.outcome === 'success') {
    const r = res.result || {};
    const warning = amountEq(r.total, task.amount) ? null : `Receipt total ${r.total} differs from the charged ${task.amount} AMD — check it.`;
    try {
      await release('issued', {
        receiptId: String(r.receiptId), fiscal: r.fiscal ? String(r.fiscal) : null, sn: r.sn || null, crn: r.crn || config.crn,
        receiptTime: Number(r.time) || null, receiptTotal: Number(r.total) || null, qr: r.qr || null,
        responseJson: toJson(res.raw), issuedAt: sqlTime(), resolvedBy: 'print', lastError: warning,
      });
    } catch (error) {
      // e.g. the receipt number is already linked to another order — the
      // receipt exists, but needs a human look.
      console.error(`[hdm] order ${order.orderNumber}: receipt ${r.receiptId} issued but could not be saved:`, error);
      await release('unknown', { responseJson: toJson(res.raw), lastError: clip(`Receipt ${r.receiptId} was issued but could not be stored: ${error.message}`) });
      return true;
    }
    console.log(`[hdm] order ${order.orderNumber}: receipt ${r.receiptId} issued (fiscal ${r.fiscal}, total ${r.total} AMD)`);
    if (warning) console.warn(`[hdm] order ${order.orderNumber}: ${warning}`);
    sendReceiptEmail(id).catch(() => {});
    return true;
  }
  if (res.outcome === 'not_sent') {
    console.warn(`[hdm] order ${order.orderNumber}: print not sent (${res.error}) — will retry`);
    await release('pending', { sentAt: null, lastError: clip(`Not sent: ${res.error}`), nextAttemptAt: sqlTime(Date.now() + backoffMs(task.attempts + 1)) });
    return true;
  }
  if (res.outcome === 'rejected') {
    console.error(`[hdm] order ${order.orderNumber}: SRC rejected the receipt — ${res.error}`);
    await release('failed', { sentAt: null, responseJson: res.raw ? toJson(res.raw) : null, lastError: clip(res.error) });
    return true;
  }
  console.error(`[hdm] order ${order.orderNumber}: receipt result UNKNOWN — ${res.error}. Not resending; reconciliation will check.`);
  await release('unknown', { responseJson: res.raw ? toJson(res.raw) : null, lastError: clip(`Unknown result: ${res.error}`) });
  return true;
}

// ---------- reconciliation of unknown results ----------
// SRC has no "find receipt by my reference" call, only printCopy(receiptId)
// for receipt numbers, which are sequential per register. Every receipt
// number that exists but isn't linked to an order is a candidate: it is
// matched to an unknown task by exact total and time (sentAt −2 min … +30
// min). An unknown task is only sent again when the whole sequence up to the
// end is accounted for (every existing receipt linked) and enough time has
// passed — i.e. its receipt provably does not exist.
export function reconcileUnknownTasks({ now = Date.now() } = {}) {
  return serial(async () => {
    const summary = { checked: 0, linked: 0, retried: 0, unexplained: [], ambiguous: [], error: null };
    const config = getHdmConfig();
    if (!config.enabled || missingConnectionSettings(config).length) return summary;
    const unknown = await all(`SELECT * FROM hdm_receipts WHERE status = 'unknown' AND crn = ? ORDER BY sentAt ASC`, [config.crn]);
    const eligible = unknown.filter((t) => t.sentAt && now - parseSqlTime(t.sentAt) >= RECONCILE_MIN_AGE_MS);
    if (!eligible.length) return summary;

    const linkedRows = await all('SELECT receiptId FROM hdm_receipts WHERE crn = ? AND receiptId IS NOT NULL', [config.crn]);
    const linked = new Set(linkedRows.map((r) => Number(r.receiptId)).filter(Number.isFinite));
    const floor = config.receiptIdFloor;
    const maxLinked = Math.max(floor, ...linked);
    const gaps = [];
    for (let id = floor + 1; id < maxLinked; id += 1) if (!linked.has(id)) gaps.push(id);
    const candidates = gaps.slice(-50);
    const open = new Set(eligible.map((t) => t.id));
    let endReachedAt = null;
    let allExplained = gaps.length <= 50;

    const tryMatch = async (receiptId, r) => {
      const time = Number(r.time) || 0;
      const matches = eligible.filter((t) => open.has(t.id) && amountEq(r.total, t.amount)
        && time >= parseSqlTime(t.sentAt) - MATCH_WINDOW.beforeMs && time <= parseSqlTime(t.sentAt) + MATCH_WINDOW.afterMs);
      if (matches.length === 1) {
        const t = matches[0];
        await run(`UPDATE hdm_receipts SET status = 'issued', receiptId = ?, fiscal = ?, sn = ?, receiptTime = ?, receiptTotal = ?, qr = ?,
            responseJson = ?, issuedAt = ?, resolvedBy = 'reconcile', lastError = NULL WHERE id = ? AND status = 'unknown'`,
          [String(receiptId), r.fiscal ? String(r.fiscal) : null, r.sn || null, time || null, Number(r.total) || null, r.qr || null, toJson({ printCopy: r }), sqlTime(), t.id]);
        open.delete(t.id);
        linked.add(receiptId);
        summary.linked += 1;
        console.log(`[hdm] reconciled: receipt ${receiptId} belongs to task ${t.id}`);
        sendReceiptEmail(t.id).catch(() => {});
        return true;
      }
      if (matches.length > 1) summary.ambiguous.push(receiptId);
      else summary.unexplained.push(receiptId);
      allExplained = false;
      return false;
    };

    try {
      for (const receiptId of candidates) {
        summary.checked += 1;
        const res = await src.printCopy(receiptId);
        if (res.outcome === 'success') await tryMatch(receiptId, res.result || {});
        else if (res.code === RECEIPT_DOES_NOT_EXIST) continue; // number never used (e.g. return/void): explained
        else throw new Error(res.error);
      }
      for (let receiptId = maxLinked + 1, probes = 0; probes < eligible.length + 5; receiptId += 1, probes += 1) {
        summary.checked += 1;
        const res = await src.printCopy(receiptId);
        if (res.outcome === 'success') {
          await tryMatch(receiptId, res.result || {});
          continue;
        }
        if (res.code === RECEIPT_DOES_NOT_EXIST) { endReachedAt = receiptId; break; }
        throw new Error(res.error);
      }
    } catch (error) {
      summary.error = error.message;
      console.error(`[hdm] reconciliation stopped: ${error.message}`);
      return summary;
    }

    // Provably not created: every existing receipt is linked, the end of the
    // sequence was reached, and the request is old enough.
    if (endReachedAt && allExplained) {
      for (const t of eligible) {
        if (!open.has(t.id) || now - parseSqlTime(t.sentAt) < CONCLUDE_NOT_CREATED_AGE_MS) continue;
        await run(`UPDATE hdm_receipts SET status = 'pending', sentAt = NULL, nextAttemptAt = NULL,
            lastError = 'Reconciliation: no receipt was created for the earlier attempt — sending again.' WHERE id = ? AND status = 'unknown'`, [t.id]);
        summary.retried += 1;
      }
    }
    if (summary.unexplained.length) console.warn(`[hdm] receipts on CRN ${config.crn} not linked to any order: ${summary.unexplained.join(', ')} — check in the SRC portal`);
    if (summary.retried) kickHdmWorker();
    return summary;
  });
}

// ---------- admin operations ----------
async function taskForOrder(orderId) {
  return get(`SELECT * FROM hdm_receipts WHERE orderId = ? AND kind = 'sale'`, [orderId]);
}

// failed / blocked → pending (after fixing the cause).
export async function retryTask(orderId) {
  const r = await run(`UPDATE hdm_receipts SET status = 'pending', nextAttemptAt = NULL, sentAt = NULL
    WHERE orderId = ? AND kind = 'sale' AND status IN ('failed', 'blocked')`, [orderId]);
  if (!r.affectedRows) return { status: 409, body: { error: 'Only a failed or blocked receipt can be retried. Unknown results must be reconciled first.' } };
  kickHdmWorker();
  return { status: 200, body: { ok: true } };
}

// unknown → pending, ONLY after the admin checked the SRC portal and
// confirmed no receipt exists for this payment.
export async function confirmNotIssued(orderId) {
  const r = await run(`UPDATE hdm_receipts SET status = 'pending', nextAttemptAt = NULL, sentAt = NULL,
      lastError = 'Admin confirmed no receipt exists for the earlier attempt — sending again.'
    WHERE orderId = ? AND kind = 'sale' AND status = 'unknown'`, [orderId]);
  if (!r.affectedRows) return { status: 409, body: { error: 'Only an unknown result can be confirmed as not issued.' } };
  kickHdmWorker();
  return { status: 200, body: { ok: true } };
}

// unknown/failed → issued with an existing SRC receipt number (found in the
// SRC portal). Verified with printCopy: the total must match unless forced.
export function linkExistingReceipt(orderId, receiptId, { force = false } = {}) {
  return serial(async () => {
    const task = await taskForOrder(orderId);
    if (!task) return { status: 404, body: { error: 'No receipt task for this order.' } };
    if (!['unknown', 'failed'].includes(task.status)) return { status: 409, body: { error: `Receipt is ${task.status}.` } };
    if (!/^\d{1,18}$/.test(String(receiptId))) return { status: 400, body: { error: 'Enter the receipt number (digits).' } };
    const res = await src.printCopy(receiptId);
    if (res.outcome !== 'success') return { status: 502, body: { error: `SRC: ${res.error}` } };
    const r = res.result || {};
    if (!amountEq(r.total, task.amount) && !force) {
      return { status: 409, body: { error: `Receipt ${receiptId} total is ${r.total} AMD, but this payment was ${task.amount} AMD.` } };
    }
    try {
      await run(`UPDATE hdm_receipts SET status = 'issued', receiptId = ?, fiscal = ?, sn = ?, crn = ?, receiptTime = ?, receiptTotal = ?, qr = ?,
          responseJson = ?, issuedAt = ?, resolvedBy = 'admin', lastError = NULL WHERE id = ?`,
        [String(receiptId), r.fiscal ? String(r.fiscal) : null, r.sn || null, r.crn || getHdmConfig().crn, Number(r.time) || null, Number(r.total) || null, r.qr || null, toJson({ printCopy: r }), sqlTime(), task.id]);
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') return { status: 409, body: { error: `Receipt ${receiptId} is already linked to another order.` } };
      throw error;
    }
    sendReceiptEmail(task.id).catch(() => {});
    return { status: 200, body: { ok: true } };
  });
}

// ---------- receipt email ----------
export async function sendReceiptEmail(taskId) {
  try {
    const claim = await run(
      `UPDATE hdm_receipts SET emailAttempts = emailAttempts + 1, emailLastAttemptAt = ?
        WHERE id = ? AND status = 'issued' AND emailSentAt IS NULL AND (emailLastAttemptAt IS NULL OR emailLastAttemptAt < ?)`,
      [sqlTime(), taskId, sqlTime(Date.now() - 2 * 60 * 1000)]);
    if (!claim.affectedRows) return { sent: false, skipped: true };
    const task = await get('SELECT * FROM hdm_receipts WHERE id = ?', [taskId]);
    const order = await get('SELECT * FROM orders WHERE id = ?', [task.orderId]);
    const result = await sendFiscalReceiptEmail({
      to: order.customerEmail,
      firstName: order.customerFirstName,
      orderNumber: order.orderNumber,
      receipt: publicReceipt(task),
      receiptUrl: receiptUrl(order.orderNumber, task.accessToken),
      qrImageUrl: receiptQrUrl(order.orderNumber, task.accessToken),
      pdfUrl: invoicePdfUrl(order.orderNumber, task.accessToken),
      paymentMethod: order.paymentMethod,
      order: {
        subtotal: Number(order.subtotal), shipping: Number(order.shipping), discountAmount: Number(order.discountAmount || 0),
        loyaltyDiscount: Number(order.loyaltyDiscount || 0), createdAt: order.createdAt,
      },
    });
    await run('UPDATE hdm_receipts SET emailSentAt = ?, emailError = ? WHERE id = ?',
      [result.sent ? sqlTime() : null, result.sent ? null : clip(result.error || 'Email was not sent (mail is not configured).', 1000), taskId]);
    if (!result.sent) console.error(`[hdm] receipt email for ${order.orderNumber} NOT sent: ${result.error || 'mail is not configured'}`);
    return result;
  } catch (error) {
    console.error(`[hdm] receipt email for task ${taskId} failed:`, error);
    await run('UPDATE hdm_receipts SET emailError = ? WHERE id = ?', [clip(`Unexpected error: ${error.message}`, 1000), taskId]).catch(() => {});
    return { sent: false, error: error.message };
  }
}

export async function retryReceiptEmails() {
  const rows = await all(
    `SELECT id, emailAttempts AS attempts, emailLastAttemptAt AS lastAttempt FROM hdm_receipts
      WHERE status = 'issued' AND emailSentAt IS NULL AND emailAttempts < ? AND issuedAt >= ? ORDER BY issuedAt ASC LIMIT 25`,
    [EMAIL_MAX_ATTEMPTS, sqlTime(Date.now() - EMAIL_RETRY_WINDOW_HOURS * 3600 * 1000)]);
  let sent = 0;
  for (const row of rows) {
    const wait = row.attempts > 0 ? 5 * 60 * 1000 * 2 ** (row.attempts - 1) : 0;
    if (row.lastAttempt && Date.now() - parseSqlTime(row.lastAttempt) < wait) continue;
    if ((await sendReceiptEmail(row.id)).sent) sent += 1;
  }
  return { sent };
}

// Resend reuses the stored receipt — never calls SRC.
export async function resendReceiptEmail(orderId) {
  const task = await taskForOrder(orderId);
  if (!task || task.status !== 'issued') return { status: 409, body: { error: 'This order has no issued receipt yet.' } };
  await run('UPDATE hdm_receipts SET emailSentAt = NULL, emailLastAttemptAt = NULL WHERE id = ?', [task.id]);
  const result = await sendReceiptEmail(task.id);
  return result.sent ? { status: 200, body: { ok: true } } : { status: 502, body: { error: result.error || 'Email was not sent.' } };
}

// ---------- reading receipts ----------
export function receiptUrl(orderNumber, accessToken) {
  return `${getPublicUrl()}/receipt/${encodeURIComponent(orderNumber)}?t=${accessToken}`;
}

export function invoicePdfUrl(orderNumber, accessToken) {
  return `${getPublicUrl()}/api/receipts/${encodeURIComponent(orderNumber)}/invoice.pdf?t=${accessToken}`;
}

// PDF invoice for an issued receipt — same access rule as the receipt
// (secret link or owning customer). Returns { status, pdf?, filename? }.
export async function getInvoicePdf(orderNumber, auth = {}) {
  const view = await getReceiptForCustomer(orderNumber, auth);
  if (view.status !== 200 || view.body.status !== 'issued') return { status: 404 };
  const order = await get('SELECT customerFirstName, customerLastName, customerEmail, createdAt FROM orders WHERE orderNumber = ?', [view.body.orderNumber]);
  const pdf = await buildInvoicePdf({
    orderNumber: view.body.orderNumber,
    orderDate: order?.createdAt ? new Date(`${String(order.createdAt).replace(' ', 'T')}Z`).toLocaleDateString('en-GB', { timeZone: 'Asia/Yerevan' }) : null,
    buyerName: [order?.customerFirstName, order?.customerLastName].filter(Boolean).join(' '),
    buyerEmail: order?.customerEmail,
    paymentMethod: view.body.paymentMethod,
    receipt: view.body.receipt,
  });
  return { status: 200, pdf, filename: `UrbanPhoenix-invoice-${view.body.orderNumber}.pdf` };
}

// PNG of the receipt's SRC QR code, for emails (mail clients block inline
// data: images). Same secret token as the receipt link.
export function receiptQrUrl(orderNumber, accessToken) {
  return `${getPublicUrl()}/api/receipts/${encodeURIComponent(orderNumber)}/qr.png?t=${accessToken}`;
}

// What a customer may see: the fiscal receipt as printed (no raw SRC
// response, no internal errors).
function publicReceipt(task) {
  const response = fromJson(task.responseJson, {}) || {};
  const r = response.result || response.printCopy || {};
  const request = fromJson(task.requestJson, {}) || {};
  return {
    receiptId: task.receiptId,
    fiscal: task.fiscal,
    crn: task.crn,
    sn: task.sn,
    tin: r.tin || getHdmConfig().tin || null,
    taxpayer: r.taxpayer || null,
    address: r.address || null,
    time: task.receiptTime ? Number(task.receiptTime) : null,
    total: task.receiptTotal != null ? Number(task.receiptTotal) : Number(task.amount),
    cardAmount: request.cardAmount ?? null,
    cashAmount: request.cashAmount ?? null,
    currency: 'AMD',
    qr: task.qr,
    items: (request.items || []).map((i) => ({ name: i.goodName, quantity: i.quantity, unit: i.unit, price: i.price, discount: i.discount || 0 })),
  };
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

// Customer access: the secret link from the receipt email, or a signed-in
// customer who owns the order. Anything else looks exactly like "not found".
export async function getReceiptForCustomer(orderNumber, { token, customerId, customerEmail } = {}) {
  const notFound = { status: 404, body: { error: 'Receipt not found.' } };
  const order = await get('SELECT id, orderNumber, customerId, customerEmail, createdAt, total, paidAmount, paidCurrency, paymentMethod FROM orders WHERE orderNumber = ?', [String(orderNumber || '').slice(0, 64)]);
  if (!order) return notFound;
  const task = await taskForOrder(order.id);
  if (!task) return notFound;
  const owns = (customerId && order.customerId && String(order.customerId) === String(customerId))
    || (customerEmail && order.customerEmail && order.customerEmail.toLowerCase() === String(customerEmail).toLowerCase());
  if (!sameSecret(token, task.accessToken) && !owns) return notFound;
  const status = task.status === 'issued' ? 'issued' : 'pending';
  return {
    status: 200,
    body: {
      orderNumber: order.orderNumber,
      status,
      paymentMethod: order.paymentMethod,
      receipt: status === 'issued' ? publicReceipt(task) : null,
    },
  };
}

// Admin view (separate from payment and order-email status).
export function adminReceiptView(task, orderNumber) {
  if (!task) return null;
  return {
    status: task.status,
    amount: Number(task.amount),
    currency: task.currency,
    attempts: task.attempts,
    lastError: task.lastError,
    sentAt: task.sentAt,
    nextAttemptAt: task.nextAttemptAt,
    receiptId: task.receiptId,
    fiscal: task.fiscal,
    crn: task.crn,
    sn: task.sn,
    receiptTime: task.receiptTime ? Number(task.receiptTime) : null,
    receiptTotal: task.receiptTotal != null ? Number(task.receiptTotal) : null,
    issuedAt: task.issuedAt,
    resolvedBy: task.resolvedBy,
    email: { sentAt: task.emailSentAt, error: task.emailError, attempts: task.emailAttempts },
    receiptUrl: task.status === 'issued' ? receiptUrl(orderNumber, task.accessToken) : null,
    invoicePdfUrl: task.status === 'issued' ? invoicePdfUrl(orderNumber, task.accessToken) : null,
    createdAt: task.createdAt,
  };
}

export async function receiptTasksByOrderIds(orderIds) {
  if (!orderIds.length) return new Map();
  const rows = await all(`SELECT * FROM hdm_receipts WHERE kind = 'sale' AND orderId IN (?)`, [orderIds]);
  return new Map(rows.map((row) => [row.orderId, row]));
}

export async function fiscalSummary() {
  const rows = await all('SELECT status, COUNT(*) AS n FROM hdm_receipts GROUP BY status');
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

// ---------- accounting reconciliation ----------
// Three-way check for a date range (Armenia time): money received (paid
// online orders: ArCa card + Idram, in AMD) vs. fiscal receipts issued vs.
// what SRC holds. Every paid online order should have exactly one ISSUED
// receipt whose total equals the amount charged. Anything else is listed as
// a problem with the reason. Cash-on-delivery orders are listed separately:
// the website does not fiscalize them (their receipt is issued at delivery).
const YEREVAN_OFFSET = '+04:00';
export async function fiscalReport({ from, to }) {
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(String(from)) || !day.test(String(to))) return { status: 400, body: { error: 'Give from and to as YYYY-MM-DD.' } };
  const start = new Date(`${from}T00:00:00${YEREVAN_OFFSET}`);
  const end = new Date(new Date(`${to}T00:00:00${YEREVAN_OFFSET}`).getTime() + 24 * 3600 * 1000);
  if (!(end > start) || end - start > 400 * 24 * 3600 * 1000) return { status: 400, body: { error: 'Choose a range of at most about a year.' } };

  const rows = await all(
    `SELECT o.id, o.orderNumber, o.createdAt, o.status, o.paymentMethod, o.paymentStatus, o.paymentProvider, o.providerTransactionId,
            o.paymentEnv, o.total, o.paidAmount, o.paidCurrency,
            h.status AS fiscalStatus, h.amount AS fiscalAmount, h.receiptId, h.fiscal, h.crn, h.receiptTotal, h.issuedAt, h.lastError,
            h.emailSentAt AS receiptEmailSentAt
       FROM orders o LEFT JOIN hdm_receipts h ON h.orderId = o.id AND h.kind = 'sale'
      WHERE o.createdAt >= ? AND o.createdAt < ?
      ORDER BY o.createdAt ASC`,
    [sqlTime(start.getTime()), sqlTime(end.getTime())]);

  const online = new Set(['arca', 'idram']);
  const lines = [];
  const summary = {
    from, to,
    paidOnline: { count: 0, amountAmd: 0 },
    receiptsIssued: { count: 0, amountAmd: 0 },
    byProvider: {},
    problems: 0,
    cashOnDelivery: { count: 0, note: 'Not fiscalized by the website — receipt issued at delivery.' },
    refundedOrCancelledWithReceipt: 0,
  };
  for (const r of rows) {
    const isOnlinePaid = online.has(String(r.paymentProvider || '')) && r.paymentEnv !== 'sandbox'
      && (r.paymentStatus === 'paid' || r.paymentStatus === 'refunded');
    if (r.paymentMethod === 'cash_on_delivery') {
      if (r.status !== 'cancelled') summary.cashOnDelivery.count += 1;
      continue;
    }
    if (!isOnlinePaid) continue;
    const paid = r.paidCurrency === 'AMD' && r.paidAmount != null ? Number(r.paidAmount) : null;
    let problem = null;
    if (r.paymentStatus === 'refunded' || r.status === 'cancelled') {
      if (r.fiscalStatus === 'issued') { problem = 'Refunded/cancelled after a receipt was issued — a return receipt is needed (not automated yet).'; summary.refundedOrCancelledWithReceipt += 1; }
    } else {
      summary.paidOnline.count += 1;
      if (paid != null) summary.paidOnline.amountAmd += paid;
      const p = (summary.byProvider[r.paymentProvider] ||= { count: 0, amountAmd: 0 });
      p.count += 1;
      if (paid != null) p.amountAmd += paid;
      if (paid == null) problem = 'Charged amount in AMD not recorded (order paid before HDM was installed).';
      else if (!r.fiscalStatus) problem = 'No receipt task — HDM was off when this order was paid.';
      else if (r.fiscalStatus !== 'issued') problem = `Receipt ${r.fiscalStatus}${r.lastError ? `: ${r.lastError}` : ''}`;
      else if (Math.round(Number(r.receiptTotal) * 100) !== Math.round(paid * 100)) problem = `Receipt total ${r.receiptTotal} AMD differs from the charged ${paid} AMD.`;
    }
    if (r.fiscalStatus === 'issued' && r.paymentStatus !== 'refunded' && r.status !== 'cancelled') {
      summary.receiptsIssued.count += 1;
      summary.receiptsIssued.amountAmd += Number(r.receiptTotal) || 0;
    }
    if (problem) summary.problems += 1;
    lines.push({
      orderNumber: r.orderNumber,
      createdAt: r.createdAt,
      provider: r.paymentProvider,
      providerTransactionId: r.providerTransactionId,
      paymentStatus: r.paymentStatus,
      paidAmountAmd: paid,
      fiscalStatus: r.fiscalStatus || 'none',
      receiptId: r.receiptId,
      fiscal: r.fiscal,
      crn: r.crn,
      receiptTotalAmd: r.receiptTotal != null ? Number(r.receiptTotal) : null,
      issuedAt: r.issuedAt,
      receiptEmailSent: Boolean(r.receiptEmailSentAt),
      problem,
    });
  }
  const round = (n) => Math.round(n * 100) / 100;
  summary.paidOnline.amountAmd = round(summary.paidOnline.amountAmd);
  summary.receiptsIssued.amountAmd = round(summary.receiptsIssued.amountAmd);
  for (const p of Object.values(summary.byProvider)) p.amountAmd = round(p.amountAmd);
  summary.differenceAmd = round(summary.paidOnline.amountAmd - summary.receiptsIssued.amountAmd);
  summary.balanced = summary.problems === 0 && summary.differenceAmd === 0;
  return { status: 200, body: { summary, lines } };
}

// ---------- background loop (server.mjs) ----------
export function startHdmWorker() {
  const tick = async () => {
    try {
      await processDueTasks();
      await reconcileUnknownTasks();
      await retryReceiptEmails();
    } catch (error) {
      console.error('[hdm] background run failed:', error);
    }
  };
  setTimeout(tick, 20 * 1000).unref();
  setInterval(tick, 60 * 1000).unref();
}
