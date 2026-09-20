import { randomUUID } from 'node:crypto';
import { all, get, run } from './db.mjs';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const clean = (value, max = 160) => String(value ?? '').trim().slice(0, max);

export async function subscribe(email) {
  const cleanEmail = clean(email, 120).toLowerCase();
  if (!emailPattern.test(cleanEmail)) return { status: 400, body: { error: 'Please enter a valid email address.' } };

  const existing = await get('SELECT id FROM newsletter_subscribers WHERE email = ?', [cleanEmail]);
  if (existing) return { status: 200, body: { message: 'You are already subscribed.' } };

  await run('INSERT INTO newsletter_subscribers (id, email) VALUES (?, ?)', [randomUUID(), cleanEmail]);
  return { status: 201, body: { message: 'Welcome to Urban Phoenix.' } };
}

export async function listSubscribers() {
  const rows = await all('SELECT * FROM newsletter_subscribers ORDER BY subscribedAt DESC');
  return rows.map((row) => ({ id: row.id, email: row.email, subscribedAt: row.subscribedAt }));
}

export async function deleteSubscriber(id) {
  const existing = await get('SELECT id FROM newsletter_subscribers WHERE id = ?', [clean(id, 80)]);
  if (!existing) return { status: 404, body: { error: 'Subscriber not found.' } };
  await run('DELETE FROM newsletter_subscribers WHERE id = ?', [existing.id]);
  return { status: 200, body: { deleted: true } };
}
