import { all, run } from './db.mjs';
import { getProduct } from './products-api.mjs';

const cleanId = (value) => String(value ?? '').trim().slice(0, 80);

// Public, read-only availability check (product page, admin). Total comes
// from the product's own limitedEditionTotal — never a hardcoded number —
// so each limited-edition product can have its own real run size.
export async function listEditions(productId) {
  const id = cleanId(productId);
  if (!id) return { status: 400, body: { error: 'Product is required.' } };
  const product = await getProduct(id);
  const total = product?.isLimitedEdition ? Number(product.limitedEditionTotal) || 0 : 0;
  const rows = await all('SELECT number FROM edition_sales WHERE productId = ? ORDER BY number', [id]);
  const sold = rows.map((row) => row.number);
  return { status: 200, body: { productId: id, total, sold, available: Math.max(0, total - sold.length) } };
}

// Simple in-process mutex so concurrent checkouts can't double-claim a
// number — every claimEditions() call across the whole process is
// serialized through this single queue, which is what actually makes the
// "read sold numbers, then insert the next free ones" sequence below safe
// under concurrency (a second call can't start until the first one's inserts
// have committed).
let queue = Promise.resolve();

// Called from order-api.mjs's commitOrder(), after an order is guaranteed to
// actually happen (payment confirmed or Cash on Delivery accepted) and
// before its row is inserted. Each limited-edition item already carries the
// customer's own chosen editionNumbers (picked on the product page via
// LimitedEditionSelector.jsx, validated shape-wise by order-api.mjs's
// validateItems()) — this is the one place that's actually authoritative
// about whether those numbers are still free: it re-reads edition_sales
// fresh, atomically, right before inserting, so a number that looked free
// when the customer selected it but got claimed by someone else in the
// meantime is still caught here, not just at the earlier, non-atomic
// pre-check. The in-process mutex queue (below) is what makes "check, then
// insert" safe under concurrency — a second concurrent call can't start
// until the first one's inserts have committed.
export function claimEditions(items, orderId) {
  const task = queue.then(async () => {
    const requestedByProduct = new Map(); // productId -> numbers[] requested across every item in this order

    for (const item of items) {
      if (!item.isLimitedEdition) continue;
      const productId = cleanId(item.productId);
      const quantity = Number(item.quantity) || 0;
      const numbers = Array.isArray(item.editionNumbers) ? item.editionNumbers.map(Number) : [];
      if (quantity <= 0) continue;
      if (numbers.length !== quantity) {
        throw new Error(`Choose ${quantity} piece number(s) for ${item.name}.`);
      }
      const current = requestedByProduct.get(productId) || [];
      requestedByProduct.set(productId, [...current, ...numbers]);
    }

    for (const [productId, numbers] of requestedByProduct) {
      if (new Set(numbers).size !== numbers.length) {
        throw new Error('THIS PIECE IS NO LONGER AVAILABLE. PLEASE SELECT ANOTHER NUMBER.');
      }
      const soldRows = await all('SELECT number FROM edition_sales WHERE productId = ?', [productId]);
      const sold = new Set(soldRows.map((row) => row.number));
      const unavailable = numbers.filter((number) => sold.has(number));
      if (unavailable.length) {
        throw new Error('THIS PIECE IS NO LONGER AVAILABLE. PLEASE SELECT ANOTHER NUMBER.');
      }
    }

    const soldAt = new Date().toISOString().slice(0, 19).replace('T', ' ');
    for (const [productId, numbers] of requestedByProduct) {
      for (const number of numbers) {
        await run('INSERT INTO edition_sales (productId, number, orderId, soldAt) VALUES (?, ?, ?, ?)', [productId, number, orderId, soldAt]);
      }
    }

    return true;
  });

  queue = task.catch(() => {});
  return task;
}

export async function listAllEditionSales() {
  const rows = await all('SELECT * FROM edition_sales ORDER BY productId, number');
  const byProduct = {};
  for (const row of rows) {
    if (!byProduct[row.productId]) byProduct[row.productId] = { productId: row.productId, sold: [] };
    byProduct[row.productId].sold.push({ number: row.number, orderId: row.orderId, soldAt: row.soldAt });
  }
  const groups = Object.values(byProduct);
  // Each product's own real total — the admin editions list must never show
  // a hardcoded "/100" for a product configured with a different run size.
  for (const group of groups) {
    const product = await getProduct(group.productId);
    group.productName = product?.name || group.productId;
    group.total = product?.isLimitedEdition ? Number(product.limitedEditionTotal) || 0 : 0;
  }
  return groups;
}

export async function releaseEdition(productId, number) {
  const id = cleanId(productId);
  const num = Number(number);
  const result = await run('DELETE FROM edition_sales WHERE productId = ? AND number = ?', [id, num]);
  return { status: 200, body: { released: result.changes > 0 } };
}

// Returns every serial an order claimed back to the pool — used only for a
// PRE-FULFILLMENT cancellation (see order-api.mjs's updateOrderStatus): once
// a piece has actually shipped/delivered, its serial must never be recycled,
// so this is deliberately never called for those statuses.
export async function releaseEditionsForOrder(orderId) {
  await run('DELETE FROM edition_sales WHERE orderId = ?', [cleanId(orderId)]);
}
