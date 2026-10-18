// Homepage editorial images (Admin → Site Content → Homepage — Editorial
// Images): default photos, saving an uploaded image, clearing (removing) an
// image, and refusing unsafe links.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { useTestDb } from '../helpers/test-db.mjs';

const testDb = useTestDb('site-content-editorial');
await testDb.ready;
const { initDb } = await import('../../server/db.mjs');
await initDb();
const { getSiteContent, updateSiteContentSection } = await import('../../server/content-api.mjs');

after(async () => { await testDb.cleanup(); });

const editorial = async () => {
  const result = await getSiteContent();
  const content = result.content || result.body?.content || result;
  return content.homeEditorial;
};

test('defaults to the current photos', async () => {
  const e = await editorial();
  assert.match(e.largeImageUrl, /^https:\/\//);
  assert.match(e.originImageUrl, /^https:\/\//);
});

test('saves an uploaded image and its alt text', async () => {
  const res = await updateSiteContentSection('homeEditorial', {
    largeImageUrl: '/uploads/123_abc.jpg', largeImageAlt: 'Campaign portrait',
    originImageUrl: '/uploads/456_def.jpg', originImageAlt: 'Court',
  });
  assert.equal(res.status, 200);
  const e = await editorial();
  assert.equal(e.largeImageUrl, '/uploads/123_abc.jpg');
  assert.equal(e.largeImageAlt, 'Campaign portrait');
  assert.equal(e.originImageUrl, '/uploads/456_def.jpg');
});

test('clearing an image removes it', async () => {
  const res = await updateSiteContentSection('homeEditorial', { largeImageUrl: '', largeImageAlt: '', originImageUrl: '/uploads/456_def.jpg', originImageAlt: 'Court' });
  assert.equal(res.status, 200);
  assert.equal((await editorial()).largeImageUrl, '');
});

test('unsafe links are never saved', async () => {
  await updateSiteContentSection('homeEditorial', { largeImageUrl: 'javascript:alert(1)', originImageUrl: 'data:text/html,hi' });
  const e = await editorial();
  assert.equal(e.largeImageUrl, '');
  assert.equal(e.originImageUrl, '');
});
