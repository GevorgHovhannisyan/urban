import { randomUUID } from 'node:crypto';
import { all, get, run, fromJson } from './db.mjs';
import { getProduct } from './products-api.mjs';
import { findQualifyingOrderId } from './order-api.mjs';

const clean = (value, max = 800) => String(value ?? '').trim().slice(0, max);

// A verified review is only ever "Owner of Piece X/100" when the exact
// order+product this review is tied to (row.orderId, set once at creation —
// never client-supplied) really did claim a real serialized edition number
// (server/edition-api.mjs's edition_sales table, via the order's own stored
// items JSON). Every other verified review — the overwhelming majority, for
// non-limited products — is just "Verified Owner", never a fabricated piece
// number. orderItemsMap is a batch-fetched Map<orderId, items[]> so callers
// serializing a whole list don't re-query per review.
async function getOrderItemsMap(orderIds) {
  const ids = [...new Set(orderIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const rows = await all(`SELECT id, items FROM orders WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  return new Map(rows.map((row) => [row.id, fromJson(row.items, [])]));
}

function serialize(row, { includeEmail = false, orderItemsMap = new Map() } = {}) {
  if (!row) return null;
  let pieceNumbers = null;
  let pieceEditionTotal = null;
  if (row.orderId && orderItemsMap.has(row.orderId)) {
    const item = orderItemsMap.get(row.orderId).find((entry) => entry.productId === row.productId);
    if (item?.editionNumbers?.length) {
      pieceNumbers = item.editionNumbers;
      // Frozen at purchase time, same as everywhere else this is shown —
      // never the product's current (possibly since-changed) config.
      pieceEditionTotal = item.editionTotal || 100;
    }
  }
  const base = {
    id: row.id,
    productId: row.productId,
    userId: row.userId,
    author: row.author,
    rating: row.rating,
    body: row.body,
    date: row.date,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    // `verified` is the DB column name (pre-dates this feature — the
    // frontend used to read `review.verified` directly); every row this
    // feature can still create has it forced to 1 by createReview() below,
    // since a review can no longer be created AT ALL without a qualifying
    // purchase. Serialized under the more explicit name the API contract
    // now documents — the frontend is updated alongside this file to read
    // `verifiedPurchase` instead of the old `verified` field.
    verifiedPurchase: Boolean(row.verified),
    // Only ever non-null when real, backend-confirmed serialized ownership
    // exists for this exact review — see getOrderItemsMap()'s doc comment.
    pieceNumbers,
    pieceEditionTotal,
    status: row.status,
  };
  if (includeEmail) base.email = row.email;
  return base;
}

export async function listReviews(productId) {
  const id = clean(productId, 50);
  const rows = await all("SELECT * FROM reviews WHERE productId = ? AND status = 'published' ORDER BY createdAt DESC", [id]);
  const orderItemsMap = await getOrderItemsMap(rows.map((row) => row.orderId));
  return { status: 200, body: { reviews: rows.map((row) => serialize(row, { orderItemsMap })) } };
}

// Powers the product page's "can I review this?" state — never assumes
// anything from the client, re-derives the same purchase check
// createReview() itself enforces, so the UI and the actual enforcement can
// never drift apart. `customer` is the verified JWT payload (or null for a
// guest) — see requireCustomer()/optionalCustomerId() in app.mjs.
export async function getReviewEligibility(customer, productId) {
  const id = clean(productId, 80);
  if (!id) return { status: 400, body: { error: 'Product is required.' } };

  if (!customer) {
    return { status: 200, body: { canReview: false, reason: 'not_authenticated' } };
  }

  const account = await get('SELECT id, email FROM customers WHERE id = ?', [customer.sub]);
  if (!account) return { status: 200, body: { canReview: false, reason: 'not_authenticated' } };

  const existing = await get('SELECT * FROM reviews WHERE productId = ? AND userId = ?', [id, account.id]);
  if (existing) {
    const orderItemsMap = await getOrderItemsMap([existing.orderId]);
    return { status: 200, body: { canReview: false, reason: 'already_reviewed', review: serialize(existing, { includeEmail: true, orderItemsMap }) } };
  }

  const orderId = await findQualifyingOrderId(account.id, account.email, id);
  if (!orderId) {
    return { status: 200, body: { canReview: false, reason: 'not_purchased' } };
  }

  return { status: 200, body: { canReview: true, reason: 'eligible' } };
}

export async function createReview(payload = {}, customer) {
  const productId = clean(payload.productId, 50);
  const body = clean(payload.body, 800);
  const rating = Number(payload.rating);

  // author/email come from the verified customer record, never from the request
  // body — otherwise a caller could submit reviews under an arbitrary name/email
  // regardless of who they actually authenticated as.
  if (!customer) return { status: 401, body: { error: 'Please sign in before writing a comment.' } };
  const account = await get('SELECT id, name, email FROM customers WHERE id = ?', [customer.sub]);
  if (!account) return { status: 401, body: { error: 'Please sign in before writing a comment.' } };
  const author = clean(account.name, 60);
  const email = clean(account.email, 120).toLowerCase();

  if (!(await getProduct(productId))) return { status: 404, body: { error: 'Product not found.' } };
  if (!body) return { status: 400, body: { error: 'Please write a comment.' } };
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { status: 400, body: { error: 'Rating must be between 1 and 5.' } };
  }
  if (body.length < 10) return { status: 400, body: { error: 'Comment must contain at least 10 characters.' } };

  // One review per customer per product — checked here (clear 409 before
  // touching the database) as well as enforced by the
  // uniq_reviews_user_product DB constraint (db.mjs), which is the real
  // guard against two near-simultaneous submissions from the same customer
  // both passing this pre-check before either has committed.
  const existingReview = await get('SELECT id FROM reviews WHERE productId = ? AND userId = ?', [productId, account.id]);
  if (existingReview) return { status: 409, body: { error: 'You have already reviewed this product.' } };

  // The actual security boundary: never trust a `verified`/orderId/userId
  // value from the request body (payload.* is never read for any of this) —
  // identity comes only from the authenticated JWT (`customer.sub`) and the
  // purchase is re-derived directly from the orders table every time.
  const orderId = await findQualifyingOrderId(account.id, email, productId);
  if (!orderId) {
    return { status: 403, body: { error: 'Only customers who purchased this product can leave a review.' } };
  }

  const id = randomUUID();
  const createdAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  try {
    await run(
      `INSERT INTO reviews (id, productId, userId, orderId, author, email, rating, body, date, createdAt, verified, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'published')`,
      [id, productId, account.id, orderId, author, email, rating, body, date, createdAt]
    );
  } catch (error) {
    // Race: two requests from the same customer both passed the pre-check
    // above before either committed — the unique index is the real guard,
    // this just turns its rejection into the same clean 409 the pre-check
    // above would have given if it had won the race.
    if (error?.code === 'ER_DUP_ENTRY') {
      return { status: 409, body: { error: 'You have already reviewed this product.' } };
    }
    throw error;
  }

  const row = await get('SELECT * FROM reviews WHERE id = ?', [id]);
  const orderItemsMap = await getOrderItemsMap([row.orderId]);
  return { status: 201, body: { review: serialize(row, { orderItemsMap }) } };
}

// Customer-facing edit — only the review's own author may call this
// (checked via `WHERE id = ? AND userId = ?`, mirroring how
// account-api.mjs's updateAddress()/deleteAddress() scope every mutation to
// `customerId`). A mismatch and a nonexistent id are deliberately
// indistinguishable (404 either way) — same "don't confirm what exists"
// posture account-api.mjs already uses for another customer's address.
export async function updateOwnReview(id, payload = {}, customer) {
  if (!customer) return { status: 401, body: { error: 'Please sign in.' } };
  const account = await get('SELECT id FROM customers WHERE id = ?', [customer.sub]);
  if (!account) return { status: 401, body: { error: 'Please sign in.' } };

  const reviewId = clean(id, 80);
  const existing = await get('SELECT * FROM reviews WHERE id = ? AND userId = ?', [reviewId, account.id]);
  if (!existing) return { status: 404, body: { error: 'Review not found.' } };

  const body = clean(payload.body, 800);
  const rating = Number(payload.rating);
  if (!body) return { status: 400, body: { error: 'Please write a comment.' } };
  if (body.length < 10) return { status: 400, body: { error: 'Comment must contain at least 10 characters.' } };
  if (payload.rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return { status: 400, body: { error: 'Rating must be between 1 and 5.' } };
  }

  const updatedAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
  await run(
    'UPDATE reviews SET body = ?, rating = ?, updatedAt = ? WHERE id = ?',
    [body, Number.isInteger(rating) ? rating : existing.rating, updatedAt, reviewId]
  );

  const row = await get('SELECT * FROM reviews WHERE id = ?', [reviewId]);
  const orderItemsMap = await getOrderItemsMap([row.orderId]);
  return { status: 200, body: { review: serialize(row, { orderItemsMap }) } };
}

export async function deleteOwnReview(id, customer) {
  if (!customer) return { status: 401, body: { error: 'Please sign in.' } };
  const account = await get('SELECT id FROM customers WHERE id = ?', [customer.sub]);
  if (!account) return { status: 401, body: { error: 'Please sign in.' } };

  const reviewId = clean(id, 80);
  const existing = await get('SELECT id FROM reviews WHERE id = ? AND userId = ?', [reviewId, account.id]);
  if (!existing) return { status: 404, body: { error: 'Review not found.' } };

  await run('DELETE FROM reviews WHERE id = ?', [reviewId]);
  return { status: 200, body: { deleted: true } };
}

export async function listAllReviews() {
  const rows = await all('SELECT * FROM reviews ORDER BY createdAt DESC');
  const orderItemsMap = await getOrderItemsMap(rows.map((row) => row.orderId));
  return rows.map((row) => serialize(row, { includeEmail: true, orderItemsMap }));
}

export async function moderateReview(id, { status }) {
  const reviewId = clean(id, 80);
  const existing = await get('SELECT id FROM reviews WHERE id = ?', [reviewId]);
  if (!existing) return { status: 404, body: { error: 'Review not found.' } };

  const allowed = new Set(['published', 'hidden']);
  if (!allowed.has(status)) return { status: 400, body: { error: 'Invalid status.' } };

  await run('UPDATE reviews SET status = ? WHERE id = ?', [status, reviewId]);
  const row = await get('SELECT * FROM reviews WHERE id = ?', [reviewId]);
  return { status: 200, body: { review: serialize(row, { includeEmail: true }) } };
}

export async function deleteReview(id) {
  const reviewId = clean(id, 80);
  const existing = await get('SELECT id FROM reviews WHERE id = ?', [reviewId]);
  if (!existing) return { status: 404, body: { error: 'Review not found.' } };
  await run('DELETE FROM reviews WHERE id = ?', [reviewId]);
  return { status: 200, body: { deleted: true } };
}
