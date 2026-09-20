import { randomUUID } from 'node:crypto';
import { all, get, run, toJson, fromJson } from './db.mjs';

// Stock is a JSON map keyed "Size|Color" -> integer quantity. An empty map
// means this product's inventory isn't tracked (always purchasable, same
// behavior as before stock existed) — this keeps every product created
// before this feature working exactly as it did.
export const LOW_STOCK_THRESHOLD = 5;
export const stockKey = (size, color) => `${size || ''}|${color || ''}`;

function stockSummary(stockMap) {
  const entries = Object.entries(stockMap || {});
  if (entries.length === 0) return { tracked: false, total: 0, isSoldOut: false, isLowStock: false };
  const total = entries.reduce((sum, [, qty]) => sum + Math.max(0, Number(qty) || 0), 0);
  const isSoldOut = total === 0;
  const isLowStock = !isSoldOut && total <= LOW_STOCK_THRESHOLD;
  return { tracked: true, total, isSoldOut, isLowStock };
}

// Drop gating: unreleased -> early-access window (logged-in only) ->
// members-only override (logged-in only, persists past public release) ->
// public. A product with no releaseAt is always live (matches every product
// created before this feature existed).
function dropStatus(row, now = new Date()) {
  const releaseAt = row.releaseAt ? new Date(row.releaseAt) : null;
  const earlyAccessAt = row.earlyAccessAt ? new Date(row.earlyAccessAt) : releaseAt;
  const membersOnly = Boolean(row.membersOnly);

  if (releaseAt && earlyAccessAt && now < earlyAccessAt) return 'upcoming';
  if (releaseAt && earlyAccessAt && now < releaseAt) return 'early-access';
  if (membersOnly) return 'members-only';
  return 'live';
}

// isLoggedIn is undefined for internal/admin callers, which always see
// everything — only public-facing routes pass a real boolean.
function isVisible(status, isLoggedIn) {
  if (status === 'upcoming') return isLoggedIn === undefined ? true : false;
  if (status === 'early-access' || status === 'members-only') return isLoggedIn === undefined ? true : isLoggedIn;
  return true;
}

function serializeRow(row, { isLoggedIn } = {}) {
  if (!row) return null;
  const stock = fromJson(row.stock, {});
  const { tracked, total, isSoldOut, isLowStock } = stockSummary(stock);
  const status = dropStatus(row);
  return {
    id: row.id,
    name: row.name,
    garmentType: row.garmentType,
    subtitle: row.subtitle,
    price: Number(row.price),
    compareAtPrice: row.compareAtPrice == null ? null : Number(row.compareAtPrice),
    collection: row.collection,
    category: row.category,
    colors: fromJson(row.colors, []),
    sizes: fromJson(row.sizes, []),
    images: fromJson(row.images, []),
    description: row.description,
    materials: row.materials,
    care: row.care,
    shipping: row.shipping,
    returns: row.returns,
    isNew: Boolean(row.isNew),
    isFeatured: Boolean(row.isFeatured),
    isLimitedEdition: Boolean(row.isLimitedEdition),
    // Real per-product edition size (e.g. 100) — null for every non-limited
    // product. Never a hardcoded global; server/edition-api.mjs reads this
    // same column to assign/report serials.
    limitedEditionTotal: row.limitedEditionTotal == null ? null : Number(row.limitedEditionTotal),
    archived: Boolean(row.archived),
    stock,
    stockTracked: tracked,
    totalStock: total,
    isSoldOut,
    isLowStock,
    releaseAt: row.releaseAt || null,
    earlyAccessAt: row.earlyAccessAt || null,
    membersOnly: Boolean(row.membersOnly),
    // null = no admin-configured override; the frontend auto-generates a
    // default Garment Explorer from garmentType/category/materials instead
    // (src/data/garmentExplorer.js) — this field only ever wins when it's
    // actually a real object, never an invented fallback from the backend.
    garmentExplorer: fromJson(row.garmentExplorer, null),
    dropStatus: status,
    isPurchasable: isVisible(status, isLoggedIn),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// Teaser feed for the Drop page — shows what's coming without leaking full
// purchasable product data (price/stock/etc.) for pieces the viewer can't
// buy yet. Deliberately excludes 'live' products (that's just the regular
// shop) and excludes 'members-only' products that are ALSO past their
// release date and already publicly purchasable — those aren't upcoming
// drops, they're just gated evergreen items.
export async function listDropTeasers() {
  const rows = await all('SELECT * FROM products WHERE archived = 0 AND releaseAt IS NOT NULL');
  return rows
    .map((row) => {
      const status = dropStatus(row);
      return { row, status };
    })
    .filter(({ status }) => status === 'upcoming' || status === 'early-access')
    .map(({ row, status }) => ({
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      images: fromJson(row.images, []),
      releaseAt: row.releaseAt,
      earlyAccessAt: row.earlyAccessAt,
      dropStatus: status,
    }))
    .sort((a, b) => new Date(a.releaseAt) - new Date(b.releaseAt));
}

// Used by order-api.mjs before accepting an item into an order — never trust
// a client's claim that a gated drop is purchasable.
export async function isProductPurchasable(productId, isLoggedIn) {
  const row = await get('SELECT releaseAt, earlyAccessAt, membersOnly FROM products WHERE id = ?', [clean(productId, 80)]);
  if (!row) return false;
  return isVisible(dropStatus(row), Boolean(isLoggedIn));
}

// Used by order-api.mjs to validate/decrement inventory server-side — never
// trust a client-submitted stock claim, same principle as edition numbers
// and promo codes.
export async function getVariantStock(productId, size, color) {
  const row = await get('SELECT stock FROM products WHERE id = ?', [clean(productId, 80)]);
  if (!row) return null;
  const stock = fromJson(row.stock, {});
  if (Object.keys(stock).length === 0) return null; // untracked — always available
  const qty = Number(stock[stockKey(size, color)]);
  return Number.isFinite(qty) ? Math.max(0, qty) : 0;
}

// Atomic, server-authoritative stock decrement — same "fold the check and
// the write into one conditional UPDATE" discipline already used for gift
// cards (tryRedeemGiftCard) and promo codes (tryCommitPromoUsage), applied
// here for the same reason: order-api.mjs's commitOrder() has a real
// `await` (the edition-claim mutex) between validateItems()'s stock
// pre-check and this decrement, which is enough of a window for two
// genuinely concurrent orders to both pass the pre-check for the last unit
// of a variant. A separate read-then-write here (the previous
// implementation) could not close that window; the WHERE clause below
// re-checks the CURRENT on-disk quantity in the same statement that writes
// it, so only as many concurrent callers as there is real stock can ever
// succeed — identical guarantee to the gift-card/promo atomic updates.
//
// JSON_SET/JSON_EXTRACT operate on the stock JSON column directly (there's
// no separate stock table/column per variant) — MySQL's native JSON
// functions, same atomic-single-statement approach the previous SQLite
// version used (json_set/json_extract there).
//
// Returns true if this call actually reserved the stock (or the variant is
// untracked, which is always "available" — matches getVariantStock's
// contract), false if there wasn't enough left. Never lets stock go
// negative: GREATEST(0, ...) in the SET clause is a redundant last-resort
// clamp, since the WHERE clause's `>= quantity` guard is what actually
// prevents overselling.
export async function tryDecrementVariantStock(productId, size, color, quantity) {
  const id = clean(productId, 80);
  const row = await get('SELECT stock FROM products WHERE id = ?', [id]);
  if (!row) return true; // product missing — order-api.mjs already validated this earlier; nothing to reserve
  const stock = fromJson(row.stock, {});
  const key = stockKey(size, color);
  if (!(key in stock)) return true; // untracked variant — always available, nothing to decrement

  const path = `$.${JSON.stringify(key)}`;
  const result = await run(
    `UPDATE products
     SET stock = JSON_SET(stock, ?, GREATEST(0, CAST(JSON_EXTRACT(stock, ?) AS SIGNED) - ?)),
         updatedAt = CURRENT_TIMESTAMP
     WHERE id = ?
       AND CAST(JSON_EXTRACT(stock, ?) AS SIGNED) >= ?`,
    [path, path, quantity, id, path, quantity]
  );

  return result.changes > 0;
}

// Non-atomic, always-succeeds, clamp-to-zero variant of the decrement above
// — used ONLY by order-api.mjs's commitOrder() for an already-charged
// Stripe order whose webhook arrived after stock ran out (enforceStock:
// false). That order must still be committed (the customer was already
// charged; rejecting it here would mean "charged with nothing to show for
// it"), so this preserves the exact pre-fix behavior for that one
// documented case: take whatever's left and clamp at 0, never reject.
// Every other caller should use tryDecrementVariantStock() above.
export async function clampDecrementVariantStock(productId, size, color, quantity) {
  const id = clean(productId, 80);
  const row = await get('SELECT stock FROM products WHERE id = ?', [id]);
  if (!row) return;
  const stock = fromJson(row.stock, {});
  const key = stockKey(size, color);
  if (!(key in stock)) return; // untracked variant — nothing to decrement
  stock[key] = Math.max(0, (Number(stock[key]) || 0) - quantity);
  await run('UPDATE products SET stock = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [toJson(stock), id]);
}

// Counterpart to decrementVariantStock() — called when an order that already
// decremented stock is cancelled, so the units become purchasable again
// instead of staying permanently "sold" for an order that was never
// fulfilled. Mirrors decrementVariantStock()'s untracked-variant no-op: a
// variant that was never in the stock map wasn't decremented either, so
// there's nothing to give back.
export async function restoreVariantStock(productId, size, color, quantity) {
  const id = clean(productId, 80);
  const row = await get('SELECT stock FROM products WHERE id = ?', [id]);
  if (!row) return;
  const stock = fromJson(row.stock, {});
  const key = stockKey(size, color);
  if (!(key in stock)) return; // untracked variant — nothing to restore
  stock[key] = Math.max(0, (Number(stock[key]) || 0) + quantity);
  await run('UPDATE products SET stock = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?', [toJson(stock), id]);
}

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const asArray = (value) => (Array.isArray(value) ? value.map((item) => clean(item, 60)) : []);

// Same http(s)-or-this-app's-own-/uploads/-path allowlist as
// content-api.mjs's cleanUrlField — an admin pasting a local file:///... or
// javascript:/data:... value into a product image field must never reach
// the storefront as a live <img src>. Rejected values are dropped, not
// truncated/half-saved.
function cleanUrl(value, max = 500) {
  const trimmed = clean(value, max);
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
  } catch {
    // not a parseable absolute URL
  }
  return '';
}

const GARMENT_EXPLORER_VIEWS = new Set(['front', 'back']);
const slugify = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// Sanitizes an admin-submitted Garment Explorer payload into the exact
// shape src/data/garmentExplorer.js's getGarmentExplorer() expects, or
// returns null if there isn't enough here to show anything real (no front
// image, or no hotspot with at least a label and a real x/y position).
// Deliberately lenient rather than error-throwing for individual malformed
// hotspots — this is an optional, non-transactional editorial feature, not
// checkout/order data, so a bad row is dropped rather than blocking the
// whole product save.
function sanitizeGarmentExplorer(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const frontImage = cleanUrl(raw.frontImage, 500);
  if (!frontImage) return null;
  const backImage = cleanUrl(raw.backImage, 500) || null;

  const seenIds = new Set();
  const hotspots = (Array.isArray(raw.hotspots) ? raw.hotspots : [])
    .map((h) => {
      if (!h || typeof h !== 'object') return null;
      const label = clean(h.label, 60);
      const x = Number(h.x);
      const y = Number(h.y);
      if (!label || !Number.isFinite(x) || !Number.isFinite(y)) return null;

      let id = clean(h.id, 60) ? slugify(clean(h.id, 60)) : slugify(label);
      if (!id) id = 'point';
      while (seenIds.has(id)) id = `${id}-2`;
      seenIds.add(id);

      return {
        id,
        view: GARMENT_EXPLORER_VIEWS.has(h.view) ? h.view : 'front',
        x: Math.min(100, Math.max(0, x)),
        y: Math.min(100, Math.max(0, y)),
        label,
        title: clean(h.title, 80) || label,
        description: clean(h.description, 600),
        material: clean(h.material, 120),
        specs: Array.isArray(h.specs) ? h.specs.map((s) => clean(s, 120)).filter(Boolean).slice(0, 10) : [],
      };
    })
    .filter(Boolean)
    .slice(0, 20);
  if (hotspots.length === 0) return null;

  return { enabled: raw.enabled !== false, frontImage, backImage, hotspots };
}

function validateProduct(payload = {}, { partial = false } = {}) {
  const errors = [];
  const fields = {};

  if (!partial || payload.name !== undefined) {
    fields.name = clean(payload.name, 120);
    if (!fields.name) errors.push('Name is required.');
  }
  if (!partial || payload.price !== undefined) {
    fields.price = Number(payload.price);
    if (!Number.isFinite(fields.price) || fields.price < 0) errors.push('Price must be a non-negative number.');
  }
  if (!partial || payload.compareAtPrice !== undefined) {
    const raw = payload.compareAtPrice;
    if (raw === null || raw === '' || raw === undefined) {
      fields.compareAtPrice = null;
    } else {
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) errors.push('Compare-at price must be a non-negative number.');
      else fields.compareAtPrice = value;
    }
  }
  if (!partial || payload.category !== undefined) fields.category = clean(payload.category, 60);
  if (!partial || payload.garmentType !== undefined) fields.garmentType = clean(payload.garmentType, 60);
  if (!partial || payload.subtitle !== undefined) fields.subtitle = clean(payload.subtitle, 120);
  if (!partial || payload.collection !== undefined) fields.collection = clean(payload.collection, 120);
  if (!partial || payload.description !== undefined) fields.description = clean(payload.description, 4000);
  if (!partial || payload.materials !== undefined) fields.materials = clean(payload.materials, 2000);
  if (!partial || payload.care !== undefined) fields.care = clean(payload.care, 2000);
  if (!partial || payload.shipping !== undefined) fields.shipping = clean(payload.shipping, 2000);
  if (!partial || payload.returns !== undefined) fields.returns = clean(payload.returns, 2000);
  if (!partial || payload.colors !== undefined) fields.colors = asArray(payload.colors);
  if (!partial || payload.sizes !== undefined) fields.sizes = asArray(payload.sizes);
  if (!partial || payload.stock !== undefined) {
    const raw = payload.stock;
    const stockMap = {};
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [key, value] of Object.entries(raw)) {
        const qty = Number(value);
        if (Number.isFinite(qty) && qty >= 0) stockMap[clean(key, 120)] = Math.floor(qty);
      }
    }
    fields.stock = stockMap;
  }
  if (!partial || payload.images !== undefined) {
    fields.images = Array.isArray(payload.images) ? payload.images.map((item) => cleanUrl(item, 500)).filter(Boolean) : [];
  }
  if (!partial || payload.isNew !== undefined) fields.isNew = Boolean(payload.isNew);
  if (!partial || payload.isFeatured !== undefined) fields.isFeatured = Boolean(payload.isFeatured);
  if (!partial || payload.isLimitedEdition !== undefined) fields.isLimitedEdition = Boolean(payload.isLimitedEdition);
  if (!partial || payload.limitedEditionTotal !== undefined) {
    const raw = payload.limitedEditionTotal;
    if (raw === null || raw === '' || raw === undefined) {
      fields.limitedEditionTotal = null;
    } else {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) errors.push('Limited edition total must be a whole number of at least 1.');
      else fields.limitedEditionTotal = value;
    }
  }
  if (!partial || payload.archived !== undefined) fields.archived = Boolean(payload.archived);
  if (!partial || payload.releaseAt !== undefined) fields.releaseAt = payload.releaseAt ? clean(payload.releaseAt, 40) : null;
  if (!partial || payload.earlyAccessAt !== undefined) fields.earlyAccessAt = payload.earlyAccessAt ? clean(payload.earlyAccessAt, 40) : null;
  if (!partial || payload.membersOnly !== undefined) fields.membersOnly = Boolean(payload.membersOnly);
  if (!partial || payload.garmentExplorer !== undefined) fields.garmentExplorer = sanitizeGarmentExplorer(payload.garmentExplorer);

  return { errors, fields };
}

// isLoggedIn: undefined = internal/admin caller (sees every product,
// regardless of drop gating); true/false = public caller, which never even
// sees products it isn't allowed to view yet.
export async function listProducts({ includeArchived = false, isLoggedIn } = {}) {
  const rows = includeArchived
    ? await all('SELECT * FROM products ORDER BY createdAt DESC')
    : await all('SELECT * FROM products WHERE archived = 0 ORDER BY createdAt DESC');
  const products = rows.map((row) => serializeRow(row, { isLoggedIn }));
  return isLoggedIn === undefined ? products : products.filter((p) => p.isPurchasable);
}

export async function getProduct(id, { isLoggedIn } = {}) {
  const row = await get('SELECT * FROM products WHERE id = ?', [clean(id, 80)]);
  return serializeRow(row, { isLoggedIn });
}

// Batch equivalent of calling getProduct() once per id — used when
// serializing a list of orders (each with several line items), so a page of
// N orders does one query instead of N * itemsPerOrder queries.
export async function getProductsByIds(ids) {
  const uniqueIds = [...new Set((ids || []).map((id) => clean(id, 80)).filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const placeholders = uniqueIds.map(() => '?').join(',');
  const rows = await all(`SELECT * FROM products WHERE id IN (${placeholders})`, uniqueIds);
  return new Map(rows.map((row) => [row.id, serializeRow(row)]));
}

export async function createProduct(payload = {}) {
  const { errors, fields } = validateProduct(payload, { partial: false });
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };

  const id = clean(payload.id, 80) || `p-${randomUUID().slice(0, 8)}`;
  const existing = await get('SELECT id FROM products WHERE id = ?', [id]);
  if (existing) return { status: 409, body: { error: 'A product with this ID already exists.' } };

  await run(
    `INSERT INTO products (
      id, name, garmentType, subtitle, price, compareAtPrice, collection, category, colors, sizes, images, stock,
      description, materials, care, shipping, returns, isNew, isFeatured, isLimitedEdition, limitedEditionTotal,
      releaseAt, earlyAccessAt, membersOnly, garmentExplorer
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      fields.name,
      fields.garmentType || '',
      fields.subtitle || '',
      fields.price,
      fields.compareAtPrice ?? null,
      fields.collection || '',
      fields.category || '',
      toJson(fields.colors || []),
      toJson(fields.sizes || []),
      toJson(fields.images || []),
      toJson(fields.stock || {}),
      fields.description || '',
      fields.materials || '',
      fields.care || '',
      fields.shipping || '',
      fields.returns || '',
      fields.isNew ? 1 : 0,
      fields.isFeatured ? 1 : 0,
      fields.isLimitedEdition ? 1 : 0,
      fields.limitedEditionTotal ?? null,
      fields.releaseAt ?? null,
      fields.earlyAccessAt ?? null,
      fields.membersOnly ? 1 : 0,
      fields.garmentExplorer ? JSON.stringify(fields.garmentExplorer) : null,
    ]
  );

  return { status: 201, body: { product: await getProduct(id) } };
}

export async function updateProduct(id, payload = {}) {
  const productId = clean(id, 80);
  const existing = await get('SELECT id FROM products WHERE id = ?', [productId]);
  if (!existing) return { status: 404, body: { error: 'Product not found.' } };

  const { errors, fields } = validateProduct(payload, { partial: true });
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };
  if (Object.keys(fields).length === 0) return { status: 400, body: { error: 'No changes provided.' } };

  const columns = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    columns.push(`${key} = ?`);
    if (['colors', 'sizes', 'images', 'stock'].includes(key)) values.push(toJson(value));
    else if (key === 'garmentExplorer') values.push(value ? JSON.stringify(value) : null);
    else if (['isNew', 'isFeatured', 'isLimitedEdition', 'archived', 'membersOnly'].includes(key)) values.push(value ? 1 : 0);
    else values.push(value);
  }
  columns.push('updatedAt = CURRENT_TIMESTAMP');
  values.push(productId);

  await run(`UPDATE products SET ${columns.join(', ')} WHERE id = ?`, values);
  return { status: 200, body: { product: await getProduct(productId) } };
}

export async function deleteProduct(id) {
  const productId = clean(id, 80);
  const existing = await get('SELECT id FROM products WHERE id = ?', [productId]);
  if (!existing) return { status: 404, body: { error: 'Product not found.' } };
  await run('DELETE FROM products WHERE id = ?', [productId]);
  return { status: 200, body: { deleted: true } };
}
