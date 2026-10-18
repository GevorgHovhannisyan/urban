// Journal cover image: an image uploaded through the admin (/uploads/<file>)
// or a public http(s) URL is accepted; local file paths and other schemes
// are rejected.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTestDb } from '../helpers/test-db.mjs';

const testDb = useTestDb('journal-cover');
await testDb.ready;
const { initDb, run } = await import('../../server/db.mjs');
await initDb();
const { createPost } = await import('../../server/journal-api.mjs');

const created = [];
after(async () => {
  for (const id of created) await run('DELETE FROM journal_posts WHERE id = ?', [id]);
  await testDb.cleanup();
});

const post = async (coverImage) => {
  const res = await createPost({ title: `Cover test ${Math.random()}`, coverImage, status: 'draft' });
  if (res.body?.post?.id) created.push(res.body.post.id);
  return res;
};

test('accepts an image uploaded through the admin', async () => {
  const res = await post('/uploads/1792335600857_6d5f9375befe.jpg');
  assert.equal(res.status, 201, JSON.stringify(res.body));
  assert.equal(res.body.post.coverImage, '/uploads/1792335600857_6d5f9375befe.jpg');
});

test('accepts a public https URL and an empty cover', async () => {
  assert.equal((await post('https://images.unsplash.com/photo-1.jpg')).status, 201);
  assert.equal((await post('')).status, 201);
});

test('rejects local file paths and unsafe values', async () => {
  for (const bad of ['C:\\Users\\PC\\Pictures\\cover.jpg', 'file:///C:/Users/PC/cover.jpg', '/uploads/../server/.env', 'javascript:alert(1)']) {
    const res = await post(bad);
    assert.equal(res.status, 400, `should reject ${bad}`);
  }
});
