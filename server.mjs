import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb } from "./server/db.mjs";
import { runSeed } from "./server/seed.mjs";
import { createApp } from "./server/app.mjs";
import { storefrontHandler } from "./server/seo.mjs";
import { assertSecureAdminConfig } from "./server/admin-config-guard.mjs";
import { assertSecurePaymentConfig } from "./server/payment-config-guard.mjs";
import {
  describePaymentConfig,
  getPaymentEnv,
  getProviderName,
} from "./server/payment/paymentService.mjs";
import { describeIdramConfig } from "./server/payment/idramService.mjs";
import {
  describeArcaConfig,
  isArcaConfigured,
  reconcilePendingArcaPayments,
} from "./server/payment/arcaService.mjs";
import { describeSmtpConfig } from "./server/mailer.mjs";
import { retryPendingConfirmationEmails } from "./server/order-api.mjs";

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
console.log(
  `Payment: provider=${getProviderName()} env=${getPaymentEnv()} — ${describePaymentConfig().message}`,
);
console.log(`Payment: ${describeIdramConfig().message}`);
console.log(`Payment: ${describeArcaConfig().message}`);

// Same diagnostic-only pattern as Stripe above — never blocks startup, never
// logs the App Password itself, just whether SMTP_HOST/PORT/USER/PASS are
// present.
console.log(`SMTP: ${describeSmtpConfig().message}`);
// Production runs on DigitalOcean, which blocks outgoing SMTP (465/587), so
// order confirmations only work there through ZeptoMail (HTTPS).
if (process.env.NODE_ENV === "production" && !process.env.ZEPTOMAIL_TOKEN) {
  console.warn(
    "WARNING: ZEPTOMAIL_TOKEN is not set — on this server SMTP ports are blocked, so order confirmation emails will FAIL. Set ZEPTOMAIL_TOKEN in .env (see .env.example).",
  );
}

// Creates every table on a fresh 'urban' database (no-op once they already
// exist) — must resolve before anything below queries the database.
await initDb();
await runSeed();

const root = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(root, "dist");
const port = Number(process.env.PORT || 4173);

const app = createApp();

// ---------- Storefront (static build) ----------
// index: false — "/" must go through storefrontHandler too, so it gets its
// page-specific <head> like every other route.
app.use(express.static(dist, { index: false }));
// Every other URL: the SPA shell with that page's title/description/social
// tags written in, and HTTP 404 (same design) for unknown pages, products
// and journal articles — see server/seo.mjs.
app.get("/{*splat}", storefrontHandler(dist));

app.listen(port, "0.0.0.0", () => {
  console.log(`Urban Phoenix server running on http://localhost:${port}`);
  console.log(`Admin panel: http://localhost:${port}/admin`);
});

// ArCa safety net: every 5 minutes, ask ArCa about recent card payments that
// never came back to the return URL (customer closed the tab after paying)
// and create the order for any that were actually paid.
if (isArcaConfigured()) {
  setInterval(() => {
    reconcilePendingArcaPayments()
      .then(({ succeeded }) => {
        if (succeeded) console.log(`[arca] reconciliation created ${succeeded} paid order(s)`);
      })
      .catch((error) => console.error("[arca] reconciliation failed:", error));
  }, 5 * 60 * 1000).unref();
}

// Order confirmation emails that failed (provider down, bad config, process
// restarted mid-send) are retried with backoff for recent orders — see
// retryPendingConfirmationEmails() in server/order-api.mjs. First run shortly
// after startup, then every 5 minutes.
const retryConfirmationEmails = () =>
  retryPendingConfirmationEmails()
    .then(({ sent, failed }) => {
      if (sent || failed) console.log(`[mail] confirmation retry: ${sent} sent, ${failed} still failing`);
    })
    .catch((error) => console.error("[mail] confirmation retry sweep failed:", error));
setTimeout(retryConfirmationEmails, 60 * 1000).unref();
setInterval(retryConfirmationEmails, 5 * 60 * 1000).unref();
