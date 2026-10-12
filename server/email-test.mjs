import {
  describeSmtpConfig,
  verifySmtpConnection,
  EMAIL_SENDERS,
  getPublicUrl,
  sendVerificationCode,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendOrderConfirmationEmail,
  sendOrderStatusEmail,
  sendAdminNewOrderEmail,
  sendGiftCardEmail,
  sendGiftCardPurchaseReceipt,
  sendContactConfirmationEmail,
} from './mailer.mjs';
import { get, fromJson } from './db.mjs';

// Admin-only email diagnostics (Admin → Email). Sends a real sample of each
// transactional email through the exact same templates and SMTP path the
// live triggers use, so delivery can be verified end to end on production —
// every sample is clearly marked as a test and never touches real orders,
// accounts or gift cards.

export const EMAIL_TEST_TYPES = [
  { id: 'verification', label: 'Account registration (verification code)' },
  { id: 'welcome', label: 'Welcome (after verification)' },
  { id: 'password-reset', label: 'Password reset' },
  { id: 'order-confirmation', label: 'Order confirmation' },
  { id: 'status-confirmed', label: 'Order status — confirmed' },
  { id: 'status-shipped', label: 'Order status — shipped' },
  { id: 'status-delivered', label: 'Order status — delivered' },
  { id: 'admin-new-order', label: 'Admin — new order alert' },
  { id: 'gift-card', label: 'Gift card (to recipient)' },
  { id: 'gift-card-receipt', label: 'Gift card purchase receipt' },
  { id: 'contact-confirmation', label: 'Contact form confirmation' },
];

const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

export async function getEmailStatus() {
  const config = describeSmtpConfig();
  const connection = config.status === 'configured' ? await verifySmtpConnection() : { ok: false, reason: config.status };
  return {
    config,
    connection,
    senders: EMAIL_SENDERS,
    adminRecipient: process.env.ORDERS_EMAIL || process.env.ADMIN_EMAIL || process.env.SMTP_USER || null,
    publicUrl: getPublicUrl(),
    publicUrlLooksLocal: /localhost|127\.0\.0\.1/.test(getPublicUrl()),
    types: EMAIL_TEST_TYPES,
  };
}

async function sampleOrder(to) {
  const product = await get('SELECT id, name, images, isLimitedEdition, limitedEditionTotal FROM products WHERE archived = 0 ORDER BY createdAt LIMIT 1');
  const images = fromJson(product?.images, []);
  const image = images[0] ? (images[0].startsWith('http') ? images[0] : `${getPublicUrl()}${images[0]}`) : null;
  const limited = Boolean(product?.isLimitedEdition);
  return {
    orderNumber: 'UP-TEST-0001',
    createdAt: new Date().toISOString(),
    status: 'confirmed',
    paymentMethod: 'card',
    paymentStatus: 'paid',
    deliveryMethod: 'standard',
    deliveryEstimate: '3–4 business days',
    customer: {
      firstName: 'Test', lastName: 'Customer', email: to, phone: '+374 00 000000',
      country: 'AM', city: 'Yerevan', postalCode: '0010', address: '1 Test Street', apartment: '', deliveryNotes: 'This is a test email.',
    },
    customerEmail: to,
    customerFirstName: 'Test',
    items: [{
      productId: product?.id || 'test',
      name: product?.name || 'Built Different. Made To Become.',
      color: 'Black', size: 'M', quantity: 1, unitPrice: 87.98, lineTotal: 87.98,
      image,
      isLimitedEdition: limited,
      editionNumbers: limited ? [7] : [],
      editionTotal: limited ? Number(product.limitedEditionTotal) || 100 : null,
    }],
    subtotal: 87.98, discountAmount: 0, giftCardAmount: 0, loyaltyDiscount: 0, shipping: 0, total: 87.98,
  };
}

export async function sendTestEmail({ type, to }) {
  const recipient = String(to || '').trim();
  if (!isEmail(recipient)) return { status: 400, body: { error: 'Enter a valid recipient email address.' } };
  if (!EMAIL_TEST_TYPES.some((t) => t.id === type)) return { status: 400, body: { error: 'Unknown email type.' } };

  let result;
  switch (type) {
    case 'verification':
      result = await sendVerificationCode({ to: recipient, name: 'Test', code: '123456' });
      break;
    case 'welcome':
      result = await sendWelcomeEmail({ to: recipient, name: 'Test' });
      break;
    case 'password-reset':
      result = await sendPasswordResetEmail({ to: recipient, name: 'Test', link: `${getPublicUrl()}/reset-password?token=TEST-LINK-DOES-NOT-WORK` });
      break;
    case 'order-confirmation':
      result = await sendOrderConfirmationEmail({ order: await sampleOrder(recipient) });
      break;
    case 'status-confirmed':
    case 'status-shipped':
    case 'status-delivered':
      result = await sendOrderStatusEmail({ order: await sampleOrder(recipient), event: type.replace('status-', '') });
      break;
    case 'admin-new-order': {
      // Goes to the real admin inbox normally; a test goes to `to` instead.
      result = await sendAdminNewOrderEmail({ order: await sampleOrder(recipient), toOverride: recipient });
      break;
    }
    case 'gift-card':
      result = await sendGiftCardEmail({
        to: recipient, code: 'TEST-GIFT-0000', amount: 50, currency: 'USD',
        senderName: 'Urban Phoenix', recipientName: 'Test', message: 'This is a test gift card email — the code does not work.',
        purchaserEmail: recipient, subjectOverride: 'TEST — You received an Urban Phoenix gift card',
      });
      break;
    case 'gift-card-receipt':
      result = await sendGiftCardPurchaseReceipt({ to: recipient, amount: 50, currency: 'USD', recipientEmail: 'friend@example.com', recipientName: 'Your Friend' });
      break;
    case 'contact-confirmation':
      result = await sendContactConfirmationEmail({ name: 'Test', email: recipient, topic: 'Test message' });
      break;
    default:
      result = { sent: false, error: 'Unknown email type.' };
  }

  const ok = Boolean(result?.sent);
  return {
    status: ok ? 200 : 502,
    body: {
      ok,
      type,
      to: recipient,
      from: result?.from || null,
      messageId: result?.messageId || null,
      response: result?.response || null,
      error: ok ? null : (result?.error || result?.reason || 'Email was not sent.'),
    },
  };
}
