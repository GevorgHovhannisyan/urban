// Spins up a real HTTP server (the actual Express app from server/app.mjs)
// bound to an ephemeral port, backed by a private, freshly created MySQL
// database — so API/integration tests get a genuine end-to-end request path
// (no mocking of routes/handlers, no mock data) against the same real MySQL
// server the app itself uses. Each call creates and later drops its own
// uniquely-named database, so test files running concurrently (node --test's
// default, one subprocess per file) never contend for the same tables or
// leak state into each other — mirrors the isolation the previous
// per-file-SQLite-file setup gave, now on top of a real MySQL server instead
// of an embedded database.
//
// Requires DB_HOST/DB_USER/DB_PASSWORD (and optionally DB_PORT) to already
// be reachable — read directly from process.env, not via dotenv/config, so a
// developer's real STRIPE_SECRET_KEY/SMTP_* never leak into a test run
// (Stripe-dependent tests set fake test keys explicitly themselves). The
// connecting DB_USER needs CREATE/DROP DATABASE privileges.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

export async function startTestServer(label = 'test') {
  if (!process.env.DB_USER) {
    throw new Error(
      'DB_USER is not set. Tests need a real, reachable MySQL server — set DB_HOST/DB_PORT/DB_USER/DB_PASSWORD ' +
      'in the environment before running the suite (the connecting user needs CREATE/DROP DATABASE privileges).'
    );
  }

  const testDbName = `up_test_${label.replace(/[^a-zA-Z0-9_]/g, '_')}_${randomUUID().slice(0, 8)}`;

  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await admin.query(`CREATE DATABASE \`${testDbName}\``);

  process.env.DB_NAME = testDbName;
  process.env.JWT_SECRET = process.env.JWT_SECRET || `test-secret-${randomUUID()}`;
  process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@urbanphoenix.com';
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  const dbModule = await import('../../server/db.mjs');
  await dbModule.initDb();
  const { runSeed } = await import('../../server/seed.mjs');
  const { createApp } = await import('../../server/app.mjs');

  await runSeed();
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.on('error', reject);
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    // Tests read/write directly against the same tables the app uses (e.g.
    // `server.db.prepare(...)`) — kept as a thin adapter over the async
    // all/get/run helpers so existing synchronous-looking test call sites
    // only need `await` added, not a full rewrite of every query string.
    db: {
      prepare(sql) {
        return {
          get: (...params) => dbModule.get(sql, params),
          all: (...params) => dbModule.all(sql, params),
          run: (...params) => dbModule.run(sql, params),
        };
      },
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await dbModule.closeDb();
      await admin.query(`DROP DATABASE \`${testDbName}\``);
      await admin.end();
    },
  };
}
