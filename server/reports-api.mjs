import { all, get, fromJson } from './db.mjs';

// Every number here comes from a real SQL aggregation over `orders` — no
// fabricated/placeholder data. Only orders that actually charged or will
// charge (i.e. not cancelled) count toward revenue.
const REVENUE_STATUSES = "status != 'cancelled'";

export async function getSummary() {
  const revenue = await get(`SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count FROM orders WHERE ${REVENUE_STATUSES}`);
  const last30 = await get(`
    SELECT COALESCE(SUM(total), 0) AS total, COUNT(*) AS count FROM orders
    WHERE ${REVENUE_STATUSES} AND createdAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
  `);
  const revenueTotal = Number(revenue.total);
  const avgOrderValue = revenue.count > 0 ? revenueTotal / revenue.count : 0;
  const customersRow = await get('SELECT COUNT(*) AS count FROM customers');

  return {
    totalRevenue: revenueTotal,
    totalOrders: revenue.count,
    revenueLast30Days: Number(last30.total),
    ordersLast30Days: last30.count,
    averageOrderValue: Number(avgOrderValue.toFixed(2)),
    totalCustomers: customersRow.count,
  };
}

// Daily revenue for the last N days — real dates with $0 filled in for days
// with no orders, so the frontend can render a continuous chart.
export async function getRevenueOverTime(days = 30) {
  const span = Math.min(365, Math.max(1, Number(days) || 30));
  const rows = await all(`
    SELECT DATE(createdAt) AS day, COALESCE(SUM(total), 0) AS total, COUNT(*) AS count
    FROM orders
    WHERE ${REVENUE_STATUSES} AND createdAt >= DATE_SUB(NOW(), INTERVAL ${span} DAY)
    GROUP BY DATE(createdAt)
    ORDER BY day ASC
  `);
  const byDay = new Map(rows.map((r) => [String(r.day), { total: Number(r.total), count: r.count }]));

  const series = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const entry = byDay.get(key);
    series.push({ date: key, revenue: entry?.total || 0, orders: entry?.count || 0 });
  }
  return series;
}

// Top products by units sold and revenue, computed by walking every order's
// JSON items array — orders.items isn't relational, so this can't be a
// simple GROUP BY.
export async function getTopProducts(limit = 10) {
  const rows = await all(`SELECT items FROM orders WHERE ${REVENUE_STATUSES}`);
  const totals = new Map();
  for (const row of rows) {
    for (const item of fromJson(row.items, [])) {
      const key = item.productId;
      if (!key) continue;
      const entry = totals.get(key) || { productId: key, name: item.name, unitsSold: 0, revenue: 0 };
      entry.unitsSold += item.quantity || 0;
      entry.revenue += item.lineTotal ?? (item.unitPrice || 0) * (item.quantity || 0);
      totals.set(key, entry);
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, Math.min(50, Math.max(1, Number(limit) || 10)))
    .map((entry) => ({ ...entry, revenue: Number(entry.revenue.toFixed(2)) }));
}

// Revenue by product category — joins each order line item's productId back
// to the products table's category.
export async function getSalesByCategory() {
  const rows = await all(`SELECT items FROM orders WHERE ${REVENUE_STATUSES}`);
  const productRows = await all('SELECT id, category FROM products');
  const categoryByProduct = new Map(productRows.map((p) => [p.id, p.category || 'Uncategorized']));
  const totals = new Map();
  for (const row of rows) {
    for (const item of fromJson(row.items, [])) {
      const category = categoryByProduct.get(item.productId) || 'Uncategorized';
      const revenue = item.lineTotal ?? (item.unitPrice || 0) * (item.quantity || 0);
      totals.set(category, (totals.get(category) || 0) + revenue);
    }
  }
  return [...totals.entries()]
    .map(([category, revenue]) => ({ category, revenue: Number(revenue.toFixed(2)) }))
    .sort((a, b) => b.revenue - a.revenue);
}

export async function getOrderStatusBreakdown() {
  const rows = await all('SELECT status, COUNT(*) AS count FROM orders GROUP BY status');
  return rows.map((r) => ({ status: r.status, count: r.count }));
}
