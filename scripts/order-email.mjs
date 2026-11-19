// Order confirmation email — diagnose, test and resend. Run from the project
// folder with the server's real .env (works on the production server too):
//
//   node --env-file=.env scripts/order-email.mjs status
//       Mail setup (provider, sender addresses, whether the provider accepts
//       the credentials — sends nothing) and the email status of the last 20
//       orders, including the error for every one that failed.
//
//   node --env-file=.env scripts/order-email.mjs preview UP-2026-ABCD1234
//       Builds that order's confirmation email without sending anything and
//       saves it as order-email-preview.html to open in a browser.
//
//   node --env-file=.env scripts/order-email.mjs send UP-2026-ABCD1234 --to you@example.com
//       Sends that order's confirmation to the address YOU choose (subject
//       starts with "[TEST]"). The customer gets nothing; the order is not
//       changed. No payment is involved.
//
//   node --env-file=.env scripts/order-email.mjs resend UP-2026-ABCD1234 --yes
//       Sends the real confirmation to the order's customer and records it
//       on the order (for one whose email failed). Needs --yes.
//
//   node --env-file=.env scripts/order-email.mjs retry --yes
//       Runs the automatic retry sweep once now (recent orders whose
//       confirmation never went out). Needs --yes.
import fs from 'node:fs';

const [command, orderNumberArg, ...rest] = process.argv.slice(2);
const flag = (name) => rest.includes(name) || orderNumberArg === name;
const option = (name) => { const i = rest.indexOf(name); return i >= 0 ? rest[i + 1] : null; };
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ''));
const maskEmail = (email) => String(email || '').replace(/^(.).*(@.*)$/, '$1***$2');

function usage(message) {
  if (message) console.error(`\n${message}\n`);
  console.error('Usage: node --env-file=.env scripts/order-email.mjs status | preview <orderNumber> | send <orderNumber> --to <email> | resend <orderNumber> --yes | retry --yes');
  process.exit(1);
}

if (!['status', 'preview', 'send', 'resend', 'retry'].includes(command)) usage();

// preview must never send: switch mail off before the mailer module loads.
if (command === 'preview') {
  for (const key of ['ZEPTOMAIL_TOKEN', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS']) process.env[key] = '';
}

const mailer = await import('../server/mailer.mjs');
const { get, all, initDb } = await import('../server/db.mjs');
// Same idempotent schema step the server runs at boot (adds the retry
// columns if this runs before the server was restarted on the new code).
await initDb();
const orders = await import('../server/order-api.mjs');

async function loadOrder(orderNumber) {
  if (!orderNumber || orderNumber.startsWith('--')) usage('Give an order number, e.g. UP-2026-ABCD1234.');
  const row = await get('SELECT * FROM orders WHERE orderNumber = ?', [orderNumber.trim()]);
  if (!row) usage(`Order ${orderNumber} not found in this database.`);
  return row;
}

async function serialized(row) {
  // Same data the live send uses (order-api.mjs's serializeOrderSingle).
  const list = await orders.listOrders();
  return list.find((order) => order.id === row.id);
}

try {
  if (command === 'status') {
    const config = mailer.describeSmtpConfig();
    console.log(`\nMail provider : ${config.message}`);
    const check = config.status === 'configured' ? await mailer.verifySmtpConnection() : { ok: false, reason: config.status };
    console.log(`Credentials   : ${check.ok ? `OK${check.note ? ` (${check.note})` : ''}` : `FAILED — ${check.reason}${check.message ? `: ${check.message}` : ''}`}`);
    console.log(`From (orders) : ${mailer.EMAIL_SENDERS.orders.name} <${mailer.EMAIL_SENDERS.orders.email}>`);
    console.log(`Reply-To      : ${mailer.EMAIL_SENDERS.support.email}`);
    console.log(`PUBLIC_URL    : ${mailer.getPublicUrl()}`);
    if (process.env.NODE_ENV === 'production' && !process.env.ZEPTOMAIL_TOKEN) console.log('WARNING       : ZEPTOMAIL_TOKEN is not set — SMTP is blocked on DigitalOcean, so sends will fail.');

    const rows = await all(`SELECT orderNumber, createdAt, status, paymentMethod, paymentStatus, paymentProvider, customerEmail,
      confirmationEmailSentAt, confirmationEmailAttempts, confirmationEmailError FROM orders ORDER BY createdAt DESC LIMIT 20`);
    console.log(`\nLast ${rows.length} orders (times are UTC):`);
    console.table(rows.map((r) => ({
      order: r.orderNumber,
      created: r.createdAt,
      status: `${r.status}/${r.paymentStatus}`,
      payment: r.paymentProvider || r.paymentMethod,
      to: maskEmail(r.customerEmail),
      emailSent: r.confirmationEmailSentAt || 'NO',
      attempts: r.confirmationEmailAttempts,
    })));
    const failed = rows.filter((r) => !r.confirmationEmailSentAt);
    if (failed.length) {
      console.log('\nOrders without a confirmation email — reason recorded:');
      for (const r of failed) console.log(`  ${r.orderNumber}: ${r.confirmationEmailError || '(no error recorded — the send never ran, e.g. an order placed before this fix or the process stopped mid-send)'}`);
    }
  }

  if (command === 'preview') {
    const order = await serialized(await loadOrder(orderNumberArg));
    const mail = mailer.buildOrderConfirmationEmail({ order });
    fs.writeFileSync('order-email-preview.html', mail.html);
    console.log(`Built the confirmation for ${order.orderNumber} (From: ${mail.from}, Subject: ${mail.subject}) — nothing was sent.`);
    console.log('Open order-email-preview.html in a browser to see it.');
  }

  if (command === 'send') {
    const to = option('--to');
    if (!isEmail(to)) usage('send needs --to <your email address>.');
    const order = await serialized(await loadOrder(orderNumberArg));
    const result = await mailer.sendOrderConfirmationEmail({
      order: { ...order, customer: { ...order.customer, email: to } },
      subjectPrefix: '[TEST] ',
    });
    console.log(result.sent
      ? `Sent the confirmation for ${order.orderNumber} to ${to} (provider id ${result.messageId || '-'}). The customer got nothing; the order was not changed.`
      : `NOT sent: ${result.error || result.reason || 'unknown error'}`);
    process.exitCode = result.sent ? 0 : 1;
  }

  if (command === 'resend') {
    if (!flag('--yes')) usage('resend emails the real customer — add --yes to confirm.');
    const row = await loadOrder(orderNumberArg);
    if (row.confirmationEmailSentAt) {
      console.log(`${row.orderNumber} was already emailed at ${row.confirmationEmailSentAt} UTC. Clearing that and sending again.`);
    }
    // Clear the "sent" mark and the 2-minute claim so the shared sender runs.
    const { run } = await import('../server/db.mjs');
    await run('UPDATE orders SET confirmationEmailSentAt = NULL, confirmationEmailLastAttemptAt = NULL WHERE id = ?', [row.id]);
    const result = await orders.sendConfirmationForOrder(row.id);
    console.log(result.sent ? `Sent to ${maskEmail(row.customerEmail)} and recorded on ${row.orderNumber}.` : `NOT sent: ${result.error || 'unknown error'} (saved on the order).`);
    process.exitCode = result.sent ? 0 : 1;
  }

  if (command === 'retry') {
    if (!flag('--yes')) usage('retry emails real customers — add --yes to confirm.');
    const { sent, failed } = await orders.retryPendingConfirmationEmails();
    console.log(`Retry sweep: ${sent} sent, ${failed} still failing (see "status" for the reasons).`);
  }
} catch (error) {
  console.error('Failed:', error);
  process.exitCode = 1;
}
// The DB pool keeps the process alive otherwise.
setTimeout(() => process.exit(process.exitCode || 0), 100);
