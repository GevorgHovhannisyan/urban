import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './server/db.mjs';
import { runSeed } from './server/seed.mjs';
import { createApp } from './server/app.mjs';
import { assertSecureAdminConfig } from './server/admin-config-guard.mjs';
import { assertSecurePaymentConfig } from './server/payment-config-guard.mjs';
import { describePaymentConfig, getPaymentEnv, getProviderName } from './server/payment/paymentService.mjs';
import { describeSmtpConfig } from './server/mailer.mjs';

// Refuses to boot (throws, crashing the process before it ever listens) if
// NODE_ENV=production and ADMIN_PASSWORD is unset or still the documented
// default — see admin-config-guard.mjs. No-op outside production, so local
// dev/preview is unaffected.
assertSecureAdminConfig();

// Refuses to boot if PAYMENT_ENV and the actual configured payment
// credentials disagree (e.g. PAYMENT_ENV=production with a Stripe test key,
// or the reverse) — see payment-config-guard.mjs for the full reasoning.
assertSecurePaymentConfig();

// Diagnostic only — never blocks startup. Logs which provider/environment is
// active and whether it's unconfigured, partially configured (dangerous —
// see describeConfig's comment), or fully configured. Never logs the actual
// key/secret values.
console.log(`Payment: provider=${getProviderName()} env=${getPaymentEnv()} — ${describePaymentConfig().message}`);

// Same diagnostic-only pattern as Stripe above — never blocks startup, never
// logs the App Password itself, just whether SMTP_HOST/PORT/USER/PASS are
// present.
console.log(`SMTP: ${describeSmtpConfig().message}`);

// Creates every table on a fresh 'urban' database (no-op once they already
// exist) — must resolve before anything below queries the database.
await initDb();
await runSeed();

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, 'dist');
const port = Number(process.env.PORT || 4173);

const app = createApp();

// ---------- Storefront (static build) ----------
app.use(express.static(dist));
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(dist, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Urban Phoenix server running on http://localhost:${port}`);
  console.log(`Admin panel: http://localhost:${port}/admin`);
});
