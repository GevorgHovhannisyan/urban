import { randomUUID, randomInt } from 'node:crypto';
import { all, get, run, fromJson } from './db.mjs';
import { hashPassword, verifyPassword } from './password.mjs';
import { sendVerificationCode } from './mailer.mjs';
import { getProductsByIds } from './products-api.mjs';
import { pointsValueInDollars } from './loyalty.mjs';
import { isSupportedShippingCountry } from '../src/data/countries.js';

const clean = (value, max = 160) => String(value ?? '').trim().slice(0, max);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getCustomerRow(id) {
  return get('SELECT * FROM customers WHERE id = ?', [id]);
}

export function memberIdFor(customerId) {
  return `UP-${String(customerId).replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

function serializeProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    memberId: memberIdFor(row.id),
    firstName: row.firstName,
    lastName: row.lastName,
    name: row.name,
    email: row.email,
    country: row.country,
    phone: row.phone,
    emailVerified: Boolean(row.emailVerified),
    createdAt: row.createdAt,
  };
}

// ---------------- Profile ----------------

export async function getProfile(customerId) {
  const row = await getCustomerRow(customerId);
  if (!row) return { status: 404, body: { error: 'Account not found.' } };
  return { status: 200, body: { profile: serializeProfile(row) } };
}

export async function updateProfile(customerId, payload = {}) {
  const row = await getCustomerRow(customerId);
  if (!row) return { status: 404, body: { error: 'Account not found.' } };

  const updates = {};
  if (payload.firstName !== undefined) {
    const v = clean(payload.firstName, 60);
    if (!v) return { status: 400, body: { error: 'First name cannot be empty.' } };
    updates.firstName = v;
  }
  if (payload.lastName !== undefined) {
    const v = clean(payload.lastName, 60);
    if (!v) return { status: 400, body: { error: 'Last name cannot be empty.' } };
    updates.lastName = v;
  }
  if (payload.country !== undefined) updates.country = clean(payload.country, 80);
  if (payload.phone !== undefined) updates.phone = clean(payload.phone, 40);

  let emailChanged = false;
  if (payload.email !== undefined) {
    const newEmail = clean(payload.email, 120).toLowerCase();
    if (!emailPattern.test(newEmail)) return { status: 400, body: { error: 'Please enter a valid email address.' } };
    if (newEmail !== row.email) {
      const existing = await get('SELECT id FROM customers WHERE email = ? AND id != ?', [newEmail, customerId]);
      if (existing) return { status: 409, body: { error: 'That email is already used by another account.' } };
      emailChanged = true;
      updates.email = newEmail;
      updates.emailVerified = 0;
      updates.verificationToken = String(randomInt(100000, 1000000));
      updates.verificationExpires = new Date(Date.now() + 30 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
      updates.verificationAttempts = 0;
    }
  }

  if (updates.firstName !== undefined || updates.lastName !== undefined) {
    const firstName = updates.firstName ?? row.firstName;
    const lastName = updates.lastName ?? row.lastName;
    updates.name = `${firstName} ${lastName}`.trim();
  }

  if (Object.keys(updates).length === 0) return { status: 400, body: { error: 'No changes provided.' } };

  const columns = Object.keys(updates).map((key) => `${key} = ?`);
  const values = Object.values(updates);
  values.push(customerId);
  await run(`UPDATE customers SET ${columns.join(', ')} WHERE id = ?`, values);

  if (emailChanged) {
    await sendVerificationCode({ to: updates.email, name: updates.firstName ?? row.firstName, code: updates.verificationToken });
  }

  const updated = await getCustomerRow(customerId);
  return {
    status: 200,
    body: {
      profile: serializeProfile(updated),
      emailChanged,
      message: emailChanged ? 'Profile updated. Please verify your new email address before it becomes active for sign-in.' : 'Profile updated.',
    },
  };
}

export async function changePassword(customerId, { currentPassword, newPassword }) {
  const row = await getCustomerRow(customerId);
  if (!row) return { status: 404, body: { error: 'Account not found.' } };
  if (!verifyPassword(String(currentPassword || ''), row.passwordHash)) {
    return { status: 401, body: { error: 'Current password is incorrect.' } };
  }
  if (!newPassword || String(newPassword).length < 8) {
    return { status: 400, body: { error: 'New password must be at least 8 characters.' } };
  }
  await run('UPDATE customers SET passwordHash = ? WHERE id = ?', [hashPassword(String(newPassword)), customerId]);
  return { status: 200, body: { message: 'Password updated.' } };
}

// ---------------- Addresses ----------------

function serializeAddress(row) {
  if (!row) return null;
  return {
    id: row.id,
    firstName: row.firstName,
    lastName: row.lastName,
    phone: row.phone,
    country: row.country,
    city: row.city,
    postalCode: row.postalCode,
    address: row.address,
    apartment: row.apartment,
    isDefault: Boolean(row.isDefault),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listAddresses(customerId) {
  const rows = await all('SELECT * FROM customer_addresses WHERE customerId = ? ORDER BY isDefault DESC, createdAt DESC', [customerId]);
  return { status: 200, body: { addresses: rows.map(serializeAddress) } };
}

function validateAddressPayload(payload = {}) {
  const fields = {
    firstName: clean(payload.firstName, 60),
    lastName: clean(payload.lastName, 60),
    phone: clean(payload.phone, 40),
    country: clean(payload.country, 80),
    city: clean(payload.city, 80),
    postalCode: clean(payload.postalCode, 30),
    address: clean(payload.address, 180),
    apartment: clean(payload.apartment, 60),
  };
  const required = ['firstName', 'lastName', 'phone', 'country', 'city', 'postalCode', 'address'];
  const missing = required.filter((key) => !fields[key]);
  if (missing.length) return { error: `Missing required fields: ${missing.join(', ')}` };
  // A saved address is a real shipping destination the customer can later
  // check out with — the same restriction order-api.mjs's validateCustomer()
  // enforces on the order itself, applied here too so an address for a
  // country we don't ship to is never even saved (the frontend's
  // <CountrySelect> in AccountAddresses.jsx already only offers
  // Armenia/the United States, but this never trusts that alone).
  if (!isSupportedShippingCountry(fields.country)) {
    return { error: 'We currently ship only to Armenia and the United States. Please select one of those as the address country.' };
  }
  return { fields };
}

export async function createAddress(customerId, payload) {
  const { error, fields } = validateAddressPayload(payload);
  if (error) return { status: 400, body: { error } };

  const countRow = await get('SELECT COUNT(*) c FROM customer_addresses WHERE customerId = ?', [customerId]);
  const makeDefault = countRow.c === 0 || Boolean(payload.isDefault);

  const id = randomUUID();
  if (makeDefault) await run('UPDATE customer_addresses SET isDefault = 0 WHERE customerId = ?', [customerId]);

  await run(
    `INSERT INTO customer_addresses (id, customerId, firstName, lastName, phone, country, city, postalCode, address, apartment, isDefault)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, customerId, fields.firstName, fields.lastName, fields.phone, fields.country, fields.city, fields.postalCode, fields.address, fields.apartment, makeDefault ? 1 : 0]
  );

  const row = await get('SELECT * FROM customer_addresses WHERE id = ?', [id]);
  return { status: 201, body: { address: serializeAddress(row) } };
}

export async function updateAddress(customerId, addressId, payload) {
  const existing = await get('SELECT * FROM customer_addresses WHERE id = ? AND customerId = ?', [addressId, customerId]);
  if (!existing) return { status: 404, body: { error: 'Address not found.' } };

  const { error, fields } = validateAddressPayload({ ...existing, ...payload });
  if (error) return { status: 400, body: { error } };

  if (payload.isDefault) await run('UPDATE customer_addresses SET isDefault = 0 WHERE customerId = ?', [customerId]);

  await run(
    `UPDATE customer_addresses SET firstName=?, lastName=?, phone=?, country=?, city=?, postalCode=?, address=?, apartment=?, isDefault=?, updatedAt=CURRENT_TIMESTAMP
     WHERE id = ?`,
    [fields.firstName, fields.lastName, fields.phone, fields.country, fields.city, fields.postalCode, fields.address, fields.apartment, payload.isDefault ? 1 : existing.isDefault, addressId]
  );

  const row = await get('SELECT * FROM customer_addresses WHERE id = ?', [addressId]);
  return { status: 200, body: { address: serializeAddress(row) } };
}

export async function deleteAddress(customerId, addressId) {
  const existing = await get('SELECT * FROM customer_addresses WHERE id = ? AND customerId = ?', [addressId, customerId]);
  if (!existing) return { status: 404, body: { error: 'Address not found.' } };
  await run('DELETE FROM customer_addresses WHERE id = ?', [addressId]);

  if (existing.isDefault) {
    const next = await get('SELECT id FROM customer_addresses WHERE customerId = ? ORDER BY createdAt ASC LIMIT 1', [customerId]);
    if (next) await run('UPDATE customer_addresses SET isDefault = 1 WHERE id = ?', [next.id]);
  }
  return { status: 200, body: { deleted: true } };
}

export async function setDefaultAddress(customerId, addressId) {
  const existing = await get('SELECT * FROM customer_addresses WHERE id = ? AND customerId = ?', [addressId, customerId]);
  if (!existing) return { status: 404, body: { error: 'Address not found.' } };
  await run('UPDATE customer_addresses SET isDefault = 0 WHERE customerId = ?', [customerId]);
  await run('UPDATE customer_addresses SET isDefault = 1 WHERE id = ?', [addressId]);
  return { status: 200, body: { address: serializeAddress(await get('SELECT * FROM customer_addresses WHERE id = ?', [addressId])) } };
}

export async function getDefaultAddress(customerId) {
  return get('SELECT * FROM customer_addresses WHERE customerId = ? AND isDefault = 1', [customerId]);
}

// ---------------- Preferences ----------------

function serializePreferences(row, customerId) {
  if (!row) {
    return {
      customerId, language: 'en', currency: 'USD', emailComms: true, dropUpdates: true,
      preferredTshirtSize: '', preferredHoodieSize: '',
    };
  }
  return {
    customerId: row.customerId,
    language: row.language,
    currency: row.currency,
    emailComms: Boolean(row.emailComms),
    dropUpdates: Boolean(row.dropUpdates),
    preferredTshirtSize: row.preferredTshirtSize,
    preferredHoodieSize: row.preferredHoodieSize,
  };
}

export async function getPreferences(customerId) {
  const row = await get('SELECT * FROM customer_preferences WHERE customerId = ?', [customerId]);
  return { status: 200, body: { preferences: serializePreferences(row, customerId) } };
}

export async function updatePreferences(customerId, payload = {}) {
  const allowedLanguages = new Set(['en', 'hy', 'ru']);
  const allowedCurrencies = new Set(['USD', 'AMD', 'EUR']);

  const currentRow = await get('SELECT * FROM customer_preferences WHERE customerId = ?', [customerId]);
  const current = serializePreferences(currentRow, customerId);
  const next = {
    language: allowedLanguages.has(payload.language) ? payload.language : current.language,
    currency: allowedCurrencies.has(payload.currency) ? payload.currency : current.currency,
    emailComms: payload.emailComms !== undefined ? Boolean(payload.emailComms) : current.emailComms,
    dropUpdates: payload.dropUpdates !== undefined ? Boolean(payload.dropUpdates) : current.dropUpdates,
    preferredTshirtSize: payload.preferredTshirtSize !== undefined ? clean(payload.preferredTshirtSize, 10) : current.preferredTshirtSize,
    preferredHoodieSize: payload.preferredHoodieSize !== undefined ? clean(payload.preferredHoodieSize, 10) : current.preferredHoodieSize,
  };

  await run(
    `INSERT INTO customer_preferences (customerId, language, currency, emailComms, dropUpdates, preferredTshirtSize, preferredHoodieSize)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       language = VALUES(language), currency = VALUES(currency), emailComms = VALUES(emailComms),
       dropUpdates = VALUES(dropUpdates), preferredTshirtSize = VALUES(preferredTshirtSize), preferredHoodieSize = VALUES(preferredHoodieSize)`,
    [customerId, next.language, next.currency, next.emailComms ? 1 : 0, next.dropUpdates ? 1 : 0, next.preferredTshirtSize, next.preferredHoodieSize]
  );

  return { status: 200, body: { preferences: next } };
}

// ---------------- Wishlist ----------------

export async function listWishlist(customerId) {
  const rows = await all('SELECT productId FROM customer_wishlist WHERE customerId = ? ORDER BY addedAt DESC', [customerId]);
  return { status: 200, body: { productIds: rows.map((r) => r.productId) } };
}

export async function addWishlistItem(customerId, productId) {
  const id = clean(productId, 80);
  if (!id) return { status: 400, body: { error: 'Product is required.' } };
  await run('INSERT IGNORE INTO customer_wishlist (customerId, productId) VALUES (?, ?)', [customerId, id]);
  return listWishlist(customerId);
}

export async function removeWishlistItem(customerId, productId) {
  await run('DELETE FROM customer_wishlist WHERE customerId = ? AND productId = ?', [customerId, clean(productId, 80)]);
  return listWishlist(customerId);
}

export async function mergeWishlist(customerId, productIds = []) {
  for (const productId of productIds) {
    const id = clean(productId, 80);
    if (id) await run('INSERT IGNORE INTO customer_wishlist (customerId, productId) VALUES (?, ?)', [customerId, id]);
  }
  return listWishlist(customerId);
}

// ---------------- Overview & limited pieces ----------------

export async function getOverview(customerId) {
  const customer = await getCustomerRow(customerId);
  if (!customer) return { status: 404, body: { error: 'Account not found.' } };

  const orders = await all('SELECT * FROM orders WHERE customerEmail = ? ORDER BY createdAt DESC', [customer.email]);
  const latestOrder = orders[0]
    ? { orderNumber: orders[0].orderNumber, status: orders[0].status, total: Number(orders[0].total), createdAt: orders[0].createdAt }
    : null;

  let limitedPiecesCount = 0;
  for (const order of orders) {
    const items = fromJson(order.items, []);
    for (const item of items) limitedPiecesCount += (item.editionNumbers || []).length;
  }

  const wishlistCountRow = await get('SELECT COUNT(*) c FROM customer_wishlist WHERE customerId = ?', [customerId]);
  const defaultAddress = await getDefaultAddress(customerId);

  return {
    status: 200,
    body: {
      memberId: memberIdFor(customerId),
      firstName: customer.firstName,
      memberSince: new Date(customer.createdAt).getFullYear(),
      totalOrders: orders.length,
      latestOrder,
      limitedPiecesCount,
      wishlistCount: wishlistCountRow.c,
      defaultAddress: defaultAddress ? serializeAddress(defaultAddress) : null,
      loyaltyPoints: customer.loyaltyPoints || 0,
      loyaltyPointsValue: pointsValueInDollars(customer.loyaltyPoints || 0),
    },
  };
}

// The Archive covers every purchased Urban Phoenix product, not only
// serialized limited pieces — `number` is only ever set when the specific
// line item actually carries real editionNumbers (claimed at checkout via
// server/edition-api.mjs's edition_sales table), never invented for a
// non-limited product. One archive entry per distinct line item: a
// serialized item still gets one entry per real claimed number (each is a
// distinct physical piece), while a non-limited item gets a single entry
// for the line (its `quantity` carried through so the UI can note "×2" etc.
// without fabricating individual unit identities that don't exist).
export async function getLimitedPieces(customerId) {
  const customer = await getCustomerRow(customerId);
  if (!customer) return { status: 404, body: { error: 'Account not found.' } };

  const orders = await all("SELECT * FROM orders WHERE customerEmail = ? AND status != 'cancelled' ORDER BY createdAt DESC", [customer.email]);
  const allItems = orders.flatMap((order) => fromJson(order.items, []));
  const productMap = await getProductsByIds(allItems.map((item) => item.productId));
  const pieces = [];
  for (const order of orders) {
    const items = fromJson(order.items, []);
    for (const item of items) {
      const product = productMap.get(item.productId);
      const base = {
        productId: item.productId,
        name: item.name,
        collection: product?.collection || '',
        image: product?.images?.[0] || null,
        color: item.color,
        size: item.size,
        orderNumber: order.orderNumber,
        acquiredAt: order.createdAt,
      };
      if (item.editionNumbers?.length) {
        // editionTotal comes from the order's own saved item data (frozen at
        // purchase time), never the product's current config — matches
        // server/edition-api.mjs's guarantee that a historical serial never
        // changes even if the product is edited later. 100 is only a
        // fallback for pieces sold before this field existed.
        for (const number of item.editionNumbers) {
          pieces.push({ ...base, number, editionTotal: item.editionTotal || 100, quantity: 1 });
        }
      } else {
        pieces.push({ ...base, number: null, quantity: item.quantity || 1 });
      }
    }
  }
  pieces.sort((a, b) => new Date(b.acquiredAt) - new Date(a.acquiredAt));
  return { status: 200, body: { pieces } };
}
