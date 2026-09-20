// Gives a test file its own private, throwaway MySQL database instead of
// sharing the real 'urban' database (or another test file's tables). Must be
// called BEFORE importing anything from server/*.mjs that touches the
// database — server/db.mjs opens its connection pool at import time, reading
// DB_NAME from the environment, so the env var has to be set first.
//
// Usage (top of the test file, before other server/* imports):
//   import { useTestDb } from '../helpers/test-db.mjs';
//   const testDb = useTestDb('order-draft');
//   const { all, get, run, toJson, initDb } = await import('../../server/db.mjs');
//   await initDb();
//   ...
//   after(() => testDb.cleanup());
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

export function useTestDb(label = 'test') {
  if (!process.env.DB_USER) {
    throw new Error(
      'DB_USER is not set. Tests need a real, reachable MySQL server — set DB_HOST/DB_PORT/DB_USER/DB_PASSWORD ' +
      'in the environment before running the suite (the connecting user needs CREATE/DROP DATABASE privileges).'
    );
  }

  const testDbName = `up_test_${label.replace(/[^a-zA-Z0-9_]/g, '_')}_${randomUUID().slice(0, 8)}`;
  let adminConn = null;

  const ready = (async () => {
    adminConn = await mysql.createConnection({
      host: process.env.DB_HOST || '127.0.0.1',
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    });
    await adminConn.query(`CREATE DATABASE \`${testDbName}\``);
  })();

  process.env.DB_NAME = testDbName;
  // Isolates JWT signing from the real app's persisted state too, so tests
  // never depend on (or write to) real runtime state.
  process.env.JWT_SECRET = process.env.JWT_SECRET || `test-secret-${randomUUID()}`;

  return {
    testDbName,
    // Resolves once the database has actually been created — call sites
    // await this before importing server/db.mjs so its pool connects to a
    // database that already exists.
    ready,
    async cleanup() {
      await ready;
      try {
        const { closeDb } = await import('../../server/db.mjs');
        await closeDb();
      } catch {
        // Module was never imported (test didn't need it) — nothing to close.
      }
      await adminConn.query(`DROP DATABASE \`${testDbName}\``);
      await adminConn.end();
    },
  };
}
