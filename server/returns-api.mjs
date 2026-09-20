import { randomUUID } from 'node:crypto';
import { all, get, run, toJson, fromJson } from './db.mjs';

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const RETURN_WINDOW_DAYS = 30;
const ALLOWED_STATUSES = new Set(['requested', 'approved', 'rejected', 'refunded']);

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    orderId: row.orderId,
    orderNumber: row.orderNumber,
    customerEmail: row.customerEmail,
    items: fromJson(row.items, []),
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function createReturnRequest(customerEmail, payload = {}) {
  const email = clean(customerEmail, 120).toLowerCase();
  const orderNumber = clean(payload.orderNumber, 40);
  if (!email || !orderNumber) return { status: 400, body: { error: 'Order number is required.' } };

  const order = await get('SELECT * FROM orders WHERE orderNumber = ? AND customerEmail = ?', [orderNumber, email]);
  if (!order) return { status: 404, body: { error: 'Order not found.' } };

  const deliveredOrConfirmed = ['confirmed', 'processing', 'shipped', 'delivered'].includes(order.status);
  if (!deliveredOrConfirmed) return { status: 400, body: { error: 'This order is not eligible for a return yet.' } };

  const daysSinceOrder = (Date.now() - new Date(order.createdAt).getTime()) / 86400000;
  if (daysSinceOrder > RETURN_WINDOW_DAYS) {
    return { status: 400, body: { error: `The ${RETURN_WINDOW_DAYS}-day return window for this order has passed.` } };
  }

  const existing = await get("SELECT id FROM return_requests WHERE orderId = ? AND status != 'rejected'", [order.id]);
  if (existing) return { status: 409, body: { error: 'A return request already exists for this order.' } };

  const orderItems = fromJson(order.items, []);
  const requestedItems = Array.isArray(payload.items) && payload.items.length > 0
    ? payload.items
        .map((item) => orderItems.find((oi) => oi.productId === item.productId && oi.size === item.size && oi.color === item.color))
        .filter(Boolean)
    : orderItems;
  if (requestedItems.length === 0) return { status: 400, body: { error: 'Select at least one item to return.' } };

  const reason = clean(payload.reason, 500);
  const id = randomUUID();
  await run(
    `INSERT INTO return_requests (id, orderId, orderNumber, customerEmail, items, reason, status)
     VALUES (?, ?, ?, ?, ?, ?, 'requested')`,
    [id, order.id, order.orderNumber, email, toJson(requestedItems), reason]
  );

  const row = await get('SELECT * FROM return_requests WHERE id = ?', [id]);
  return { status: 201, body: { returnRequest: serialize(row) } };
}

export async function listMyReturnRequests(customerEmail) {
  const email = clean(customerEmail, 120).toLowerCase();
  const rows = await all('SELECT * FROM return_requests WHERE customerEmail = ? ORDER BY createdAt DESC', [email]);
  return rows.map(serialize);
}

export async function listAllReturnRequests() {
  const rows = await all('SELECT * FROM return_requests ORDER BY createdAt DESC');
  return rows.map(serialize);
}

export async function updateReturnStatus(id, status) {
  const returnId = clean(id, 80);
  if (!ALLOWED_STATUSES.has(status)) return { status: 400, body: { error: 'Invalid status.' } };
  const existing = await get('SELECT id FROM return_requests WHERE id = ?', [returnId]);
  if (!existing) return { status: 404, body: { error: 'Return request not found.' } };

  await run('UPDATE return_requests SET status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [status, returnId]);
  const row = await get('SELECT * FROM return_requests WHERE id = ?', [returnId]);
  return { status: 200, body: { returnRequest: serialize(row) } };
}
