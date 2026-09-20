import { randomUUID } from 'node:crypto';
import { all, get, run, toJson, fromJson } from './db.mjs';

const clean = (value, max = 200) => String(value ?? '').trim().slice(0, max);

const slugify = (value) => clean(value, 120)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    body: row.body,
    coverImage: row.coverImage,
    author: row.author,
    relatedProductIds: fromJson(row.relatedProductIds, []),
    status: row.status,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listPublishedPosts() {
  const rows = await all("SELECT * FROM journal_posts WHERE status = 'published' ORDER BY publishedAt DESC");
  return rows.map(serialize);
}

export async function getPostBySlug(slug) {
  const row = await get("SELECT * FROM journal_posts WHERE slug = ? AND status = 'published'", [clean(slug, 80)]);
  return serialize(row);
}

export async function listAllPosts() {
  const rows = await all('SELECT * FROM journal_posts ORDER BY createdAt DESC');
  return rows.map(serialize);
}

export async function getPostById(id) {
  const row = await get('SELECT * FROM journal_posts WHERE id = ?', [clean(id, 80)]);
  return serialize(row);
}

function validatePayload(payload = {}, { partial = false } = {}) {
  const errors = [];
  const fields = {};

  if (!partial || payload.title !== undefined) {
    fields.title = clean(payload.title, 160);
    if (!fields.title) errors.push('Title is required.');
  }
  if (!partial || payload.excerpt !== undefined) fields.excerpt = clean(payload.excerpt, 400);
  if (!partial || payload.body !== undefined) fields.body = clean(payload.body, 20000);
  if (!partial || payload.coverImage !== undefined) {
    fields.coverImage = clean(payload.coverImage, 500);
    // A local file:// path (or any non-http URL) works fine on the admin's
    // own machine when previewing, but is unreachable — and blocked by the
    // browser as a security risk — for every other visitor once published.
    if (fields.coverImage && !/^https?:\/\//i.test(fields.coverImage)) {
      errors.push('Cover image must be a public http(s) URL, not a local file path.');
    }
  }
  if (!partial || payload.author !== undefined) fields.author = clean(payload.author, 100) || 'Urban Phoenix';
  if (!partial || payload.status !== undefined) {
    fields.status = clean(payload.status, 20);
    if (!['published', 'draft'].includes(fields.status)) errors.push('Status must be "published" or "draft".');
  }
  if (!partial || payload.relatedProductIds !== undefined) {
    fields.relatedProductIds = Array.isArray(payload.relatedProductIds)
      ? payload.relatedProductIds.map((id) => clean(id, 80)).filter(Boolean)
      : [];
  }
  if (!partial || payload.slug !== undefined) {
    const rawSlug = payload.slug ? slugify(payload.slug) : slugify(payload.title || fields.title || '');
    fields.slug = rawSlug;
    if (!fields.slug) errors.push('Could not derive a URL slug from the title.');
  }

  return { errors, fields };
}

export async function createPost(payload = {}) {
  const { errors, fields } = validatePayload(payload, { partial: false });
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };

  let slug = fields.slug;
  let suffix = 2;
  while (await get('SELECT id FROM journal_posts WHERE slug = ?', [slug])) {
    slug = `${fields.slug}-${suffix}`;
    suffix += 1;
  }

  const id = randomUUID();
  await run(
    `INSERT INTO journal_posts (id, title, slug, excerpt, body, coverImage, author, relatedProductIds, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, fields.title, slug, fields.excerpt || '', fields.body || '', fields.coverImage || '', fields.author || 'Urban Phoenix', toJson(fields.relatedProductIds || []), fields.status || 'published']
  );

  return { status: 201, body: { post: await getPostById(id) } };
}

export async function updatePost(id, payload = {}) {
  const postId = clean(id, 80);
  const existing = await get('SELECT * FROM journal_posts WHERE id = ?', [postId]);
  if (!existing) return { status: 404, body: { error: 'Post not found.' } };

  const { errors, fields } = validatePayload(payload, { partial: true });
  if (errors.length) return { status: 400, body: { error: errors.join(' ') } };
  if (Object.keys(fields).length === 0) return { status: 400, body: { error: 'No changes provided.' } };

  if (fields.slug && fields.slug !== existing.slug) {
    const clash = await get('SELECT id FROM journal_posts WHERE slug = ? AND id != ?', [fields.slug, postId]);
    if (clash) return { status: 409, body: { error: 'A post with this slug already exists.' } };
  }

  const columns = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    columns.push(`${key} = ?`);
    values.push(key === 'relatedProductIds' ? toJson(value) : value);
  }
  columns.push('updatedAt = CURRENT_TIMESTAMP');
  values.push(postId);

  await run(`UPDATE journal_posts SET ${columns.join(', ')} WHERE id = ?`, values);
  return { status: 200, body: { post: await getPostById(postId) } };
}

export async function deletePost(id) {
  const postId = clean(id, 80);
  const existing = await get('SELECT id FROM journal_posts WHERE id = ?', [postId]);
  if (!existing) return { status: 404, body: { error: 'Post not found.' } };
  await run('DELETE FROM journal_posts WHERE id = ?', [postId]);
  return { status: 200, body: { deleted: true } };
}
