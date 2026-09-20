import mysql from 'mysql2/promise';

// MySQL connection settings come from the environment only — see
// .env.example. DB_NAME defaults to 'urban' (the database this project was
// migrated onto), everything else must be supplied by the operator; there is
// no embedded/local fallback database anymore (this used to be node:sqlite
// writing to data/urbanphoenix.db — that file is no longer read or written).
const {
  DB_HOST = '127.0.0.1',
  DB_PORT = '3306',
  DB_USER,
  DB_PASSWORD,
  DB_NAME = 'urban',
} = process.env;

if (!DB_USER) {
  throw new Error(
    'DB_USER is not set. This app now reads/writes a real MySQL database (see .env.example\'s DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME) — there is no mock/embedded fallback.'
  );
}

export const pool = mysql.createPool({
  host: DB_HOST,
  port: Number(DB_PORT),
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
  dateStrings: true, // keep DATETIME columns as 'YYYY-MM-DD HH:MM:SS' strings, matching the previous SQLite-string format the rest of the app already parses
  // mysql2 returns DECIMAL columns as strings by default (to avoid silent
  // precision loss); this app already does all its money math in JS floats
  // (see gift-card-api.mjs's ROUND()-on-every-write comments — it already
  // fights float rounding the same way its SQLite REAL columns needed),
  // so native numbers here match the app's existing arithmetic model
  // instead of requiring a Number(...) conversion at every single call site.
  decimalNumbers: true,
});

// Thin promise-based helpers replacing node:sqlite's synchronous
// db.prepare(sql).get()/.all()/.run() API. Every call site elsewhere in
// server/ was rewritten from that synchronous shape to these — `get`
// returns a single row (or undefined), `all` returns every matching row,
// `run` returns { insertId, affectedRows, changes } for INSERT/UPDATE/DELETE.
export async function all(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

export async function get(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0];
}

export async function run(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return { insertId: result.insertId, affectedRows: result.affectedRows, changes: result.affectedRows };
}

// Runs several statements against a single connection inside a transaction —
// used wherever the old code relied on better-sqlite3/node:sqlite's implicit
// single-writer-connection consistency for a multi-step read-modify-write
// (stock decrement, gift-card/promo redemption, order status reversal).
// `fn` receives { query, get, run } bound to the dedicated transaction
// connection (never the pool) so every statement inside it participates in
// the same transaction.
export async function withTransaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const txHelpers = {
      all: async (sql, params = []) => (await conn.query(sql, params))[0],
      get: async (sql, params = []) => (await conn.query(sql, params))[0][0],
      run: async (sql, params = []) => {
        const [result] = await conn.query(sql, params);
        return { insertId: result.insertId, affectedRows: result.affectedRows, changes: result.affectedRows };
      },
    };
    const result = await fn(txHelpers);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function closeDb() {
  await pool.end();
}

// MySQL/InnoDB (the default engine, used by every CREATE TABLE below)
// enforces declared foreign keys unconditionally — there is no equivalent of
// SQLite's per-connection PRAGMA to toggle. Kept as a function (not a
// constant) so callers/tests that used to check this after opening a
// connection still have something to call.
export async function isForeignKeyEnforcementActive() {
  const row = await get('SELECT @@foreign_key_checks AS v');
  return Number(row?.v) === 1;
}

// Full schema, translated from the previous SQLite DDL:
//  - TEXT PRIMARY KEY (UUID strings) -> VARCHAR(64) PRIMARY KEY
//  - REAL -> DECIMAL(12,2) for money columns, DOUBLE for multipliers/rates
//  - INTEGER 0/1 flags -> TINYINT(1)
//  - datetime('now') defaults -> CURRENT_TIMESTAMP (same 'YYYY-MM-DD HH:MM:SS'
//    string shape the app already parses, since the pool above sets
//    dateStrings: true)
//  - `CREATE UNIQUE INDEX ... WHERE idempotencyKey IS NOT NULL` (SQLite
//    partial index) -> a plain UNIQUE index; MySQL already treats NULL as
//    distinct from every other NULL in a unique index (same semantics), so
//    no WHERE clause is needed to get "unique only when non-null".
//  - `INSERT OR IGNORE` -> `INSERT IGNORE`
//  - json_set/json_extract atomic updates -> MySQL's native JSON_SET/
//    JSON_EXTRACT, which work directly against these TEXT/JSON columns.
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(64) PRIMARY KEY,
    name TEXT NOT NULL,
    garmentType TEXT,
    subtitle TEXT,
    price DECIMAL(12,2) NOT NULL,
    compareAtPrice DECIMAL(12,2),
    collection TEXT,
    category TEXT,
    colors JSON NOT NULL,
    sizes JSON NOT NULL,
    images JSON NOT NULL,
    stock JSON NOT NULL,
    description TEXT,
    materials TEXT,
    care TEXT,
    shipping TEXT,
    returns TEXT,
    isNew TINYINT(1) NOT NULL DEFAULT 0,
    isFeatured TINYINT(1) NOT NULL DEFAULT 0,
    isLimitedEdition TINYINT(1) NOT NULL DEFAULT 0,
    limitedEditionTotal INT NULL,
    archived TINYINT(1) NOT NULL DEFAULT 0,
    releaseAt DATETIME NULL,
    earlyAccessAt DATETIME NULL,
    membersOnly TINYINT(1) NOT NULL DEFAULT 0,
    garmentExplorer JSON NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(64) PRIMARY KEY,
    orderNumber VARCHAR(64) NOT NULL UNIQUE,
    createdAt DATETIME NOT NULL,
    status VARCHAR(32) NOT NULL,
    paymentMethod VARCHAR(32) NOT NULL,
    paymentStatus VARCHAR(32) NOT NULL,
    currency VARCHAR(8) NOT NULL,
    region VARCHAR(32),
    priceMultiplier DOUBLE NOT NULL DEFAULT 1,
    customerFirstName TEXT,
    customerLastName TEXT,
    customerEmail VARCHAR(255),
    customerPhone TEXT,
    customerCountry TEXT,
    customerCity TEXT,
    customerPostalCode TEXT,
    customerAddress TEXT,
    customerApartment TEXT NULL,
    deliveryNotes TEXT NULL,
    items JSON NOT NULL,
    subtotal DECIMAL(12,2) NOT NULL,
    shipping DECIMAL(12,2) NOT NULL,
    total DECIMAL(12,2) NOT NULL,
    promoCode VARCHAR(64),
    discountAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    customerId VARCHAR(64),
    idempotencyKey VARCHAR(191),
    giftCardCode VARCHAR(64),
    giftCardAmount DECIMAL(12,2) NOT NULL DEFAULT 0,
    loyaltyDiscount DECIMAL(12,2) NOT NULL DEFAULT 0,
    loyaltyPointsUsed INT NOT NULL DEFAULT 0,
    loyaltyPointsGranted INT NOT NULL DEFAULT 0,
    loyaltyReverted TINYINT(1) NOT NULL DEFAULT 0,
    deliveryMethod VARCHAR(32) NULL,
    deliveryEstimate VARCHAR(160) NULL,
    paymentProvider VARCHAR(32) NULL,
    providerTransactionId VARCHAR(191) NULL,
    paymentEnv VARCHAR(16) NULL,
    confirmationEmailSentAt DATETIME NULL,
    confirmationEmailError TEXT NULL,
    UNIQUE KEY idx_orders_idempotency_key (idempotencyKey),
    KEY idx_orders_customer_email (customerEmail),
    KEY idx_orders_customer_id (customerId)
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS reviews (
    id VARCHAR(64) PRIMARY KEY,
    productId VARCHAR(64) NOT NULL,
    userId VARCHAR(64) NULL,
    orderId VARCHAR(64) NULL,
    author TEXT NOT NULL,
    email TEXT,
    rating INT NOT NULL,
    body TEXT NOT NULL,
    date TEXT,
    createdAt DATETIME NOT NULL,
    updatedAt DATETIME NULL,
    verified TINYINT(1) NOT NULL DEFAULT 0,
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    KEY idx_reviews_product_id (productId),
    KEY idx_reviews_user_id (userId),
    UNIQUE KEY uniq_reviews_user_product (userId, productId)
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS edition_sales (
    productId VARCHAR(64) NOT NULL,
    number INT NOT NULL,
    orderId VARCHAR(64),
    soldAt DATETIME NOT NULL,
    PRIMARY KEY (productId, number)
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS admin_users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS promo_codes (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    type VARCHAR(32) NOT NULL DEFAULT 'percentage',
    value DOUBLE NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    maxUses INT,
    usedCount INT NOT NULL DEFAULT 0,
    minSubtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
    expiresAt DATETIME NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(64) PRIMARY KEY,
    name TEXT NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    firstName VARCHAR(60) NOT NULL DEFAULT '',
    lastName VARCHAR(60) NOT NULL DEFAULT '',
    country VARCHAR(80) NOT NULL DEFAULT '',
    phone VARCHAR(40) NOT NULL DEFAULT '',
    emailVerified TINYINT(1) NOT NULL DEFAULT 0,
    verificationToken VARCHAR(191) NULL,
    verificationExpires DATETIME NULL,
    verificationAttempts INT NOT NULL DEFAULT 0,
    resetToken VARCHAR(191) NULL,
    resetExpires DATETIME NULL,
    loyaltyPoints INT NOT NULL DEFAULT 0
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS gift_cards (
    id VARCHAR(64) PRIMARY KEY,
    code VARCHAR(64) NOT NULL UNIQUE,
    initialValue DECIMAL(12,2) NOT NULL,
    balance DECIMAL(12,2) NOT NULL,
    recipientEmail VARCHAR(255) NOT NULL DEFAULT '',
    active TINYINT(1) NOT NULL DEFAULT 1,
    expiresAt DATETIME NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    purchaserEmail VARCHAR(255) NOT NULL DEFAULT '',
    senderName VARCHAR(80) NOT NULL DEFAULT '',
    recipientName VARCHAR(80) NOT NULL DEFAULT '',
    message VARCHAR(500) NOT NULL DEFAULT '',
    source VARCHAR(32) NOT NULL DEFAULT 'admin',
    pendingPurchaseId VARCHAR(64) NULL,
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    emailSentAt DATETIME NULL,
    emailError TEXT NULL
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS journal_posts (
    id VARCHAR(64) PRIMARY KEY,
    title TEXT NOT NULL,
    slug VARCHAR(191) NOT NULL UNIQUE,
    excerpt TEXT NOT NULL,
    body LONGTEXT NOT NULL,
    coverImage TEXT NOT NULL,
    author VARCHAR(120) NOT NULL DEFAULT 'Urban Phoenix',
    relatedProductIds JSON NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'published',
    publishedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS return_requests (
    id VARCHAR(64) PRIMARY KEY,
    orderId VARCHAR(64) NOT NULL,
    orderNumber VARCHAR(64) NOT NULL,
    customerEmail VARCHAR(255) NOT NULL,
    items JSON NOT NULL,
    reason TEXT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'requested',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS customer_addresses (
    id VARCHAR(64) PRIMARY KEY,
    customerId VARCHAR(64) NOT NULL,
    firstName TEXT NOT NULL,
    lastName TEXT NOT NULL,
    phone TEXT NOT NULL,
    country TEXT NOT NULL,
    city TEXT NOT NULL,
    postalCode TEXT NOT NULL,
    address TEXT NOT NULL,
    apartment TEXT NOT NULL,
    isDefault TINYINT(1) NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_addr_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS customer_preferences (
    customerId VARCHAR(64) PRIMARY KEY,
    language VARCHAR(16) NOT NULL DEFAULT 'en',
    currency VARCHAR(8) NOT NULL DEFAULT 'USD',
    emailComms TINYINT(1) NOT NULL DEFAULT 1,
    dropUpdates TINYINT(1) NOT NULL DEFAULT 1,
    preferredTshirtSize VARCHAR(16) NOT NULL DEFAULT '',
    preferredHoodieSize VARCHAR(16) NOT NULL DEFAULT '',
    CONSTRAINT fk_prefs_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS customer_wishlist (
    customerId VARCHAR(64) NOT NULL,
    productId VARCHAR(64) NOT NULL,
    addedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (customerId, productId),
    CONSTRAINT fk_wishlist_customer FOREIGN KEY (customerId) REFERENCES customers(id) ON DELETE CASCADE
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    subscribedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS pending_checkouts (
    id VARCHAR(64) PRIMARY KEY,
    draft LONGTEXT NOT NULL,
    stripeSessionId VARCHAR(191) NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paymentIntentId VARCHAR(191) NULL,
    type VARCHAR(32) NOT NULL DEFAULT 'order'
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS site_content (
    section VARCHAR(64) PRIMARY KEY,
    data JSON NOT NULL,
    updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB;`,

  // Media Library: one row per file actually uploaded through Admin (see
  // server/media-api.mjs). Deliberately just tracks metadata about a file
  // that already exists in data/uploads/ (server/uploads.mjs) — it is never
  // itself the storage layer, so this table can later be repointed at
  // cloud/object storage without changing its shape (url would just become
  // an absolute CDN URL instead of a /uploads/... path).
  `CREATE TABLE IF NOT EXISTS media (
    id VARCHAR(64) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    url VARCHAR(500) NOT NULL,
    mimeType VARCHAR(100) NOT NULL,
    kind VARCHAR(16) NOT NULL DEFAULT 'image',
    width INT NULL,
    height INT NULL,
    sizeBytes INT NOT NULL DEFAULT 0,
    alt VARCHAR(300) NOT NULL DEFAULT '',
    uploadedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_media_uploaded_at (uploadedAt)
  ) ENGINE=InnoDB;`,

  `CREATE TABLE IF NOT EXISTS gift_card_transactions (
    id VARCHAR(64) PRIMARY KEY,
    giftCardId VARCHAR(64) NOT NULL,
    orderId VARCHAR(64),
    amountApplied DECIMAL(12,2) NOT NULL,
    currency VARCHAR(8) NOT NULL,
    balanceBefore DECIMAL(12,2) NOT NULL,
    balanceAfter DECIMAL(12,2) NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_gift_card_transactions_card (giftCardId),
    CONSTRAINT fk_gct_card FOREIGN KEY (giftCardId) REFERENCES gift_cards(id) ON DELETE CASCADE
  ) ENGINE=InnoDB;`,
];

// Lightweight migration helpers for a database that already existed before
// a column/index was added here — `CREATE TABLE IF NOT EXISTS` above only
// ever affects a brand-new database; an already-provisioned 'urban'
// database keeps whatever shape it had when it was first created. Mirrors
// the old node:sqlite version's `ensureColumn()` (see git history) for the
// same reason, just against MySQL's information_schema instead of `PRAGMA
// table_info`. Both are idempotent — safe to call on every boot.
async function ensureColumn(table, column, definition) {
  const existing = await get(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]
  );
  if (!existing) await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
async function ensureIndex(table, indexName, definition) {
  const existing = await get(
    'SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [table, indexName]
  );
  if (!existing) await pool.query(`ALTER TABLE ${table} ADD ${definition}`);
}

let initPromise = null;

// Creates every table (idempotent — CREATE TABLE IF NOT EXISTS) if this is a
// fresh 'urban' database, and no-ops on every subsequent app start. Must be
// awaited before any query runs — server.mjs and the test server bootstrap
// both call this first, since (unlike the old node:sqlite version) schema
// creation here is asynchronous.
export function initDb() {
  if (!initPromise) {
    initPromise = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await pool.query(statement);
      }
      // Verified Purchase Reviews: backfills these onto a 'reviews' table
      // that was created before userId/orderId/updatedAt existed. Safe to
      // run against a table that already has them (each call no-ops) and
      // safe against existing rows (userId defaults to NULL, and MySQL
      // treats every NULL as distinct in a unique index — see the schema
      // comment above idx_orders_idempotency_key for the same reasoning —
      // so old reviews with no userId can never collide with each other or
      // block a real customer's first review).
      await ensureColumn('reviews', 'userId', 'VARCHAR(64) NULL');
      await ensureColumn('reviews', 'orderId', 'VARCHAR(64) NULL');
      await ensureColumn('reviews', 'updatedAt', 'DATETIME NULL');
      await ensureIndex('reviews', 'idx_reviews_user_id', 'KEY idx_reviews_user_id (userId)');
      await ensureIndex('reviews', 'uniq_reviews_user_product', 'UNIQUE KEY uniq_reviews_user_product (userId, productId)');
      // Delivery / payment-provider architecture (server/delivery.mjs,
      // server/payment/): every column below is nullable and additive — a
      // pre-existing order simply has NULL for fields it predates, and
      // nothing that already reads/writes the orders table needs to change.
      await ensureColumn('orders', 'deliveryMethod', 'VARCHAR(32) NULL');
      // The real delivery-time estimate text (e.g. "Up to 3 business days"),
      // resolved from server/delivery.mjs and snapshotted onto the order at
      // commit time — same reasoning as every other order-item snapshot in
      // this codebase (price, product name, edition number): if the business
      // later changes its stated estimates, an already-placed order must
      // keep showing exactly what the customer was actually promised, not a
      // re-derived, possibly different, current value. NULL for any order
      // placed before this column existed.
      await ensureColumn('orders', 'deliveryEstimate', 'VARCHAR(160) NULL');
      await ensureColumn('orders', 'customerApartment', 'TEXT NULL');
      await ensureColumn('orders', 'deliveryNotes', 'TEXT NULL');
      await ensureColumn('orders', 'paymentProvider', 'VARCHAR(32) NULL');
      await ensureColumn('orders', 'providerTransactionId', 'VARCHAR(191) NULL');
      await ensureColumn('orders', 'paymentEnv', 'VARCHAR(16) NULL');
      await ensureColumn('orders', 'confirmationEmailSentAt', 'DATETIME NULL');
      await ensureColumn('orders', 'confirmationEmailError', 'TEXT NULL');
      // Limited Edition Serial Number System: per-product edition size, so
      // "100" is no longer a hardcoded global assumption (server/edition-api.mjs
      // reads this instead). NULL for every non-limited product, matching
      // isLimitedEdition's own default-off behavior.
      await ensureColumn('products', 'limitedEditionTotal', 'INT NULL');
      // Backfill only — every product that was already marked limited-edition
      // before this column existed relied on the old system's hardcoded run
      // size of 100 (server/edition-api.mjs's previous normalizeNumbers()).
      // Without this, those existing products would suddenly become
      // unpurchasable (order-api.mjs now requires a real, non-null total)
      // the moment this deploys — this preserves their exact prior behavior.
      // Idempotent: only ever touches rows still sitting at NULL, so it
      // never overwrites a total an admin has since configured.
      await pool.query(
        'UPDATE products SET limitedEditionTotal = 100 WHERE isLimitedEdition = 1 AND limitedEditionTotal IS NULL'
      );
      // One-time cleanup: server/products-api.mjs's image-save path now
      // rejects a non-http(s)/relative image URL outright (see its own
      // cleanUrl()), but that validation didn't exist when some earlier
      // rows were saved — a local file:///... path pasted directly into a
      // product's gallery is inert (browsers refuse to load a local file
      // from a remote page) and renders as a permanently broken image.
      // Idempotent: only ever strips an entry that's already unsafe/dead,
      // never touches a real http(s) or /uploads/... URL, and only runs
      // once per boot — safe to leave in place going forward as a standing
      // guard against the same class of bad data however it got in.
      const galleryRows = await pool.query('SELECT id, images FROM products WHERE images IS NOT NULL');
      for (const row of galleryRows[0]) {
        let images;
        try { images = typeof row.images === 'string' ? JSON.parse(row.images) : row.images; } catch { continue; }
        if (!Array.isArray(images) || images.length === 0) continue;
        const cleaned = images.filter((url) => typeof url === 'string' && (url.startsWith('/') || /^https?:\/\//i.test(url)));
        if (cleaned.length !== images.length) {
          await pool.query('UPDATE products SET images = ? WHERE id = ?', [JSON.stringify(cleaned), row.id]);
        }
      }
    })();
  }
  return initPromise;
}

export function toJson(value) {
  return JSON.stringify(value ?? []);
}

export function fromJson(value, fallback = []) {
  if (value == null) return fallback;
  // mysql2 already parses JSON-typed columns into JS values for us; only
  // plain strings (e.g. a value that came from application code before it
  // was written, or a legacy TEXT column) need JSON.parse.
  if (typeof value !== 'string') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}
