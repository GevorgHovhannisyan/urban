// OPTIONAL, DEV-ONLY fixture seeder — inserts the larger demo catalog
// (src/data/devProducts.js) for local UI testing against a bigger, more
// varied product set than the real (currently 3-product) catalog. This is
// NEVER called from server/seed.mjs's runSeed() — the normal app boot path
// never touches this file, so a real/production database can never end up
// with this demo data just from starting the server normally.
//
// Run it explicitly and only in development:
//   node server/seeds/devProducts.mjs
import { run, toJson } from '../db.mjs';
import { devProducts } from '../../src/data/devProducts.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo/fake products: NODE_ENV=production.');
  process.exit(1);
}

let inserted = 0;
for (const product of devProducts) {
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
console.log(`Seeded ${inserted} dev fixture product(s) into the database.`);
process.exit(0);
