// Boots a real server instance for Playwright's webServer to launch: the
// production Express app (server/app.mjs) plus the built frontend (dist/,
// built by `npm run build` — see the test:e2e script), backed by a private,
// freshly created MySQL database instead of the shared runtime 'urban'
// database, on its own port (4174 by default) distinct from the dev server
// (5173) and the "real" production preview (4173) so e2e runs never collide
// with either while a developer has them open.
//
// Requires DB_HOST/DB_USER/DB_PASSWORD (and optionally DB_PORT) to already be
// set in the environment — read directly from process.env, not dotenv, so a
// developer's real Stripe/SMTP secrets never leak into an e2e run.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

if (!process.env.DB_USER) {
  throw new Error('DB_USER is not set. e2e tests need a real, reachable MySQL server — set DB_HOST/DB_PORT/DB_USER/DB_PASSWORD first.');
}

const e2eDbName = `up_e2e_${randomUUID().slice(0, 8)}`;
const admin = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
await admin.query(`CREATE DATABASE \`${e2eDbName}\``);
await admin.end();

process.env.DB_NAME = e2eDbName;
process.env.JWT_SECRET = process.env.JWT_SECRET || `e2e-secret-${randomUUID()}`;
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@urbanphoenix.com';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const port = Number(process.env.PORT || 4174);

const { initDb } = await import('../../server/db.mjs');
await initDb();
const { runSeed } = await import('../../server/seed.mjs');
const { createApp } = await import('../../server/app.mjs');

await runSeed();

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(root, '../../dist');
const app = createApp();
app.use(express.static(dist));
app.get('/{*splat}', (req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(port, '127.0.0.1', () => {
  console.log(`E2E test server ready on http://127.0.0.1:${port} (db: ${e2eDbName})`);
});
