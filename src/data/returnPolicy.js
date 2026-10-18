// Return policy — the single rule shared by the server (returns-api.mjs,
// which enforces it) and the account page (AccountOrders.jsx, which decides
// whether to offer "Request return"). Keep the wording on the site's legal
// pages in sync with these numbers.
//
// Returns are accepted within RETURN_WINDOW_DAYS of DELIVERY. The delivery
// date is recorded on the order (orders.deliveredAt) when an admin marks it
// Delivered. Orders delivered before that column existed have no date, so
// they fall back to order date + longest delivery estimate + the return
// window — never stricter than the real policy.
export const RETURN_WINDOW_DAYS = 15;
export const MAX_DELIVERY_DAYS = 20;

const RETURNABLE_STATUSES = new Set(['confirmed', 'processing', 'shipped', 'delivered']);
const DAY_MS = 86400000;

// DB DATETIMEs arrive as "YYYY-MM-DD HH:MM:SS" in UTC (no zone marker).
function parseUtc(value) {
  if (!value) return null;
  const str = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(str) ? `${str.replace(' ', 'T')}Z` : str);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Last moment a return can be requested, or null when there's no deadline
// yet (order still on its way — returns may be requested before delivery).
export function returnDeadline(order) {
  const delivered = parseUtc(order?.deliveredAt);
  if (delivered) return new Date(delivered.getTime() + RETURN_WINDOW_DAYS * DAY_MS);
  if (order?.status === 'delivered') {
    const created = parseUtc(order.createdAt);
    return created ? new Date(created.getTime() + (MAX_DELIVERY_DAYS + RETURN_WINDOW_DAYS) * DAY_MS) : null;
  }
  return null;
}

export function isReturnWindowOpen(order, now = new Date()) {
  if (!order || !RETURNABLE_STATUSES.has(order.status)) return false;
  const deadline = returnDeadline(order);
  return !deadline || now <= deadline;
}
