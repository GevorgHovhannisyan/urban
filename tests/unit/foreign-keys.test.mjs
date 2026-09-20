// Verifies InnoDB foreign key enforcement (server/db.mjs's schema — every
// table uses ENGINE=InnoDB, which enforces declared FKs unconditionally,
// unlike SQLite where it needed an explicit per-connection PRAGMA) actually
// rejects a write referencing a nonexistent parent row, and that
// ON DELETE CASCADE is honored.
//
// Runs against an isolated, freshly created MySQL database (same pattern as
// tests/helpers/test-server.mjs), never the real 'urban' database — DB_NAME
// must be set (and the database created) BEFORE db.mjs is first imported in
// this process, since it builds its connection pool once at module load time.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { useTestDb } from '../helpers/test-db.mjs';

const testDb = useTestDb('fk');
await testDb.ready;
const { run, get, initDb, isForeignKeyEnforcementActive } = await import('../../server/db.mjs');
await initDb();

after(async () => {
  await testDb.cleanup();
});

test('foreign key enforcement is active on this connection', async () => {
  assert.equal(await isForeignKeyEnforcementActive(), true);
});

test('inserting a customer_address for a nonexistent customerId is rejected', async () => {
  await assert.rejects(
    run(
      `INSERT INTO customer_addresses (id, customerId, firstName, lastName, country, city, postalCode, address)
       VALUES (?, ?, 'Ghost', 'Customer', 'Armenia', 'Yerevan', '0001', '1 St')`,
      [randomUUID(), 'this-customer-id-does-not-exist']
    ),
    /foreign key constraint fails/i
  );
});

test('inserting a real customer, then an address for them, succeeds (enforcement does not break valid writes)', async () => {
  const customerId = randomUUID();
  await run(
    `INSERT INTO customers (id, name, firstName, lastName, email, passwordHash)
     VALUES (?, 'Real Customer', 'Real', 'Customer', ?, 'x:x')`,
    [customerId, `fk-test-${customerId}@example.com`]
  );

  await assert.doesNotReject(
    run(
      `INSERT INTO customer_addresses (id, customerId, firstName, lastName, country, city, postalCode, address)
       VALUES (?, ?, 'Real', 'Customer', 'Armenia', 'Yerevan', '0001', '1 St')`,
      [randomUUID(), customerId]
    )
  );
});

test('deleting a customer cascades to their addresses (ON DELETE CASCADE is honored once enforcement is active)', async () => {
  const customerId = randomUUID();
  const addressId = randomUUID();
  await run(
    `INSERT INTO customers (id, name, firstName, lastName, email, passwordHash)
     VALUES (?, 'Cascade Customer', 'Cascade', 'Customer', ?, 'x:x')`,
    [customerId, `fk-cascade-${customerId}@example.com`]
  );
  await run(
    `INSERT INTO customer_addresses (id, customerId, firstName, lastName, country, city, postalCode, address)
     VALUES (?, ?, 'Cascade', 'Customer', 'Armenia', 'Yerevan', '0001', '1 St')`,
    [addressId, customerId]
  );

  await run('DELETE FROM customers WHERE id = ?', [customerId]);

  const remaining = await get('SELECT id FROM customer_addresses WHERE id = ?', [addressId]);
  assert.equal(remaining, undefined, 'the address row should be gone too, via ON DELETE CASCADE');
});
