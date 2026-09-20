import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { get, run, toJson } from './db.mjs';
import { hashPassword } from './password.mjs';
import { COLLECTION_001_PRODUCTS } from './seeds/collection001.mjs';
import { garmentExplorerByProductId } from '../src/data/garmentExplorer.js';

async function readJsonFile(relativePath, fallback) {
  try {
    const contents = await readFile(path.resolve(process.cwd(), relativePath), 'utf8');
    const parsed = JSON.parse(contents);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function toMysqlDatetime(value) {
  const date = value ? new Date(value) : new Date();
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// INSERT IGNORE so re-running this (e.g. after adding a new product to
// server/seeds/collection001.mjs) backfills newly added catalog items
// without touching rows that already exist — including ones an admin has
// since edited via the dashboard. This is the ONLY product data this
// script ever seeds — no demo/fake catalog is seeded by default (see
// server/seeds/devProducts.mjs for the separate, explicitly-invoked,
// dev-only fixture seed if one is ever needed for local testing).
async function seedProducts() {
  let inserted = 0;
  for (const product of COLLECTION_001_PRODUCTS) {
    const result = await run(
      `INSERT IGNORE INTO products (
        id, name, garmentType, subtitle, price, compareAtPrice, collection, category,
        colors, sizes, images, stock, description, materials, care, shipping, returns,
        isNew, isFeatured, isLimitedEdition
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        product.id,
        product.name ?? '',
        product.garmentType ?? '',
        product.subtitle ?? '',
        Number(product.price) || 0,
        product.compareAtPrice ? Number(product.compareAtPrice) : null,
        product.collection ?? '',
        product.category ?? '',
        toJson(product.colors),
        toJson(product.sizes),
        toJson(product.images),
        toJson(product.stock || {}),
        product.description ?? '',
        product.materials ?? '',
        product.care ?? '',
        product.shipping ?? '',
        product.returns ?? '',
        product.isNew ? 1 : 0,
        product.isFeatured ? 1 : 0,
        product.isLimitedEdition ? 1 : 0,
      ]
    );
    if (result.changes > 0) inserted += 1;
  }
  if (inserted > 0) console.log(`Seeded ${inserted} new product(s) into the database.`);
}

// One-time backfill of the hand-authored Garment Explorer example that used
// to live only in src/data/garmentExplorer.js's frontend override map, now
// that Garment Explorer is admin-editable (products.garmentExplorer). Only
// ever writes when the column is still NULL for that product — an admin who
// has since edited (or intentionally cleared) it owns that value from then
// on; this never overwrites a real edit, same "backfill only" discipline as
// seedProducts()'s INSERT IGNORE above.
async function seedGarmentExplorerDefaults() {
  let seeded = 0;
  for (const [productId, config] of Object.entries(garmentExplorerByProductId)) {
    const result = await run('UPDATE products SET garmentExplorer = ? WHERE id = ? AND garmentExplorer IS NULL', [JSON.stringify(config), productId]);
    if (result.changes > 0) seeded += 1;
  }
  if (seeded > 0) console.log(`Seeded Garment Explorer configuration for ${seeded} product(s).`);
}

async function seedOrders() {
  const countRow = await get('SELECT COUNT(*) AS count FROM orders');
  if (countRow.count > 0) return;

  const orders = await readJsonFile('data/orders.json', []);
  if (!Array.isArray(orders) || orders.length === 0) return;

  for (const order of orders) {
    await run(
      `INSERT IGNORE INTO orders (
        id, orderNumber, createdAt, status, paymentMethod, paymentStatus, currency, region,
        priceMultiplier, customerFirstName, customerLastName, customerEmail, customerPhone,
        customerCountry, customerCity, customerPostalCode, customerAddress, items, subtotal, shipping, total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        order.id || randomUUID(),
        order.orderNumber,
        toMysqlDatetime(order.createdAt),
        order.status || 'confirmed',
        order.paymentMethod || 'card',
        order.paymentStatus || 'not_charged',
        order.currency || 'USD',
        order.region || 'OTHER',
        Number(order.priceMultiplier) || 1,
        order.customer?.firstName || '',
        order.customer?.lastName || '',
        order.customer?.email || '',
        order.customer?.phone || '',
        order.customer?.country || '',
        order.customer?.city || '',
        order.customer?.postalCode || '',
        order.customer?.address || '',
        toJson(order.items),
        Number(order.subtotal) || 0,
        Number(order.shipping) || 0,
        Number(order.total) || 0,
      ]
    );
  }
  console.log(`Seeded ${orders.length} orders into the database.`);
}

async function seedReviews() {
  const countRow = await get('SELECT COUNT(*) AS count FROM reviews');
  if (countRow.count > 0) return;

  const reviews = await readJsonFile('data/reviews.json', []);
  if (!Array.isArray(reviews) || reviews.length === 0) return;

  for (const review of reviews) {
    await run(
      `INSERT IGNORE INTO reviews (id, productId, author, email, rating, body, date, createdAt, verified, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        review.id || randomUUID(),
        review.productId,
        review.author || 'Anonymous',
        review.email || '',
        Number(review.rating) || 5,
        review.body || '',
        review.date || '',
        toMysqlDatetime(review.createdAt),
        review.verified ? 1 : 0,
        review.status || 'published',
      ]
    );
  }
  console.log(`Seeded ${reviews.length} reviews into the database.`);
}

async function seedEditions() {
  const countRow = await get('SELECT COUNT(*) AS count FROM edition_sales');
  if (countRow.count > 0) return;

  const editions = await readJsonFile('data/editions.json', {});
  let total = 0;
  for (const [productId, state] of Object.entries(editions || {})) {
    const sales = Array.isArray(state?.sales) ? state.sales : [];
    for (const sale of sales) {
      await run('INSERT IGNORE INTO edition_sales (productId, number, orderId, soldAt) VALUES (?, ?, ?, ?)', [
        productId, Number(sale.number), sale.orderId || null, toMysqlDatetime(sale.soldAt),
      ]);
      total += 1;
    }
  }
  if (total) console.log(`Seeded ${total} edition sales into the database.`);
}

async function seedJournal() {
  const countRow = await get('SELECT COUNT(*) AS count FROM journal_posts');
  if (countRow.count > 0) return;

  const posts = [
    {
      id: randomUUID(),
      title: 'The Weight of Becoming: Inside Collection 001',
      slug: 'the-weight-of-becoming-collection-001',
      excerpt: 'Every piece in Collection 001 carries the weight of intention — heavyweight cottons, technical materials, and silhouettes built to move between the street and the stage.',
      body: 'Urban Phoenix was founded on a single idea: clothing should carry the weight of transformation.\n\nCollection 001 is the first chapter — built from 380gsm heavyweight cotton, satin-shelled outerwear, and a color story rooted in ash, charcoal, and rust. Every silhouette is oversized by design, dropped shoulders and boxy cuts that leave room to move, to become.\n\nThis is not a seasonal drop. It is a starting point.',
      coverImage: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=1600&h=1000&fit=crop&auto=format&q=85',
      author: 'Urban Phoenix',
      relatedProductIds: toJson(['p001', 'p002']),
      status: 'published',
      publishedAt: toMysqlDatetime(Date.now() - 6 * 86400000),
    },
    {
      id: randomUUID(),
      title: 'Forged in the Streets: Our Design Philosophy',
      slug: 'forged-in-the-streets-design-philosophy',
      excerpt: 'We move through streetwear, sport, and culture. We take from all of it and give back something that belongs to none of it.',
      body: 'Design at Urban Phoenix starts on the street, not the mood board.\n\nWe study how garments actually get worn — layered, weathered, lived in — and build backward from there. Every stitch, every fabric weight, every silhouette decision is tested against one question: does this hold up to real life?\n\nThat is the only design philosophy we have ever needed.',
      coverImage: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=1600&h=1000&fit=crop&auto=format&q=85',
      author: 'Urban Phoenix',
      relatedProductIds: toJson(['p007', 'p008']),
      status: 'published',
      publishedAt: toMysqlDatetime(Date.now() - 2 * 86400000),
    },
    {
      id: randomUUID(),
      title: 'Care Guide: Making Heavyweight Cotton Last',
      slug: 'care-guide-heavyweight-cotton',
      excerpt: 'Heavyweight cotton rewards the right care. Here is how to keep your pieces looking new for years, not months.',
      body: 'Heavyweight cotton — the 380gsm we use across the tee and crewneck line — is built to last decades, not seasons, if you treat it right.\n\nWash cold, inside out, with like colors. Skip the dryer when you can; heavyweight cotton holds its shape better air-dried. When you do tumble dry, use low heat only.\n\nThe goal is a garment that gets better with age, not one that falls apart after a season.',
      coverImage: 'https://images.unsplash.com/photo-1503342217505-b0a15ec3261c?w=1600&h=1000&fit=crop&auto=format&q=85',
      author: 'Urban Phoenix',
      relatedProductIds: toJson(['p001', 'p010']),
      status: 'published',
      publishedAt: toMysqlDatetime(Date.now() - 1 * 86400000),
    },
  ];

  for (const post of posts) {
    await run(
      `INSERT INTO journal_posts (id, title, slug, excerpt, body, coverImage, author, relatedProductIds, status, publishedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [post.id, post.title, post.slug, post.excerpt, post.body, post.coverImage, post.author, post.relatedProductIds, post.status, post.publishedAt]
    );
  }
  console.log(`Seeded ${posts.length} journal posts into the database.`);
}

async function seedAdmin() {
  const countRow = await get('SELECT COUNT(*) AS count FROM admin_users');
  if (countRow.count > 0) return;

  const email = (process.env.ADMIN_EMAIL || 'admin@urbanphoenix.com').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  await run('INSERT INTO admin_users (id, email, passwordHash) VALUES (?, ?, ?)', [randomUUID(), email, hashPassword(password)]);
  console.log(`Created default admin account: ${email}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log('WARNING: using default admin password "ChangeMe123!" — set ADMIN_EMAIL/ADMIN_PASSWORD in .env and restart to change it.');
  }
}

export async function runSeed() {
  await seedProducts();
  await seedGarmentExplorerDefaults();
  await seedOrders();
  await seedReviews();
  await seedEditions();
  await seedJournal();
  await seedAdmin();
}

export { hashPassword };
