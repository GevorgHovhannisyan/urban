import nodemailer from "nodemailer";
import { getDeliveryMethod, defaultDeliveryMethod } from "./delivery.mjs";
import { getCountryName } from "../src/data/countries.js";

const {
  SMTP_HOST,
  SMTP_PORT,
  SMTP_USER,
  SMTP_PASS,
  SMTP_SECURE,
  SMTP_FROM,
  SUPPORT_EMAIL,
  ORDERS_EMAIL,
  ADMIN_EMAIL,
  PUBLIC_URL,
} = process.env;
console.log(
  `SMTP config: host=${SMTP_HOST}, port=${SMTP_PORT}, user=${SMTP_USER}, pass=${SMTP_PASS ? "***" : "(not set)"}, secure=${SMTP_SECURE}, from=${SMTP_FROM}, support=${SUPPORT_EMAIL}, orders=${ORDERS_EMAIL}, admin=${ADMIN_EMAIL}`,
);
// Every HTML email below interpolates user-supplied text (account name, gift
// card sender/recipient name, personal message, contact-form fields) directly
// into the markup. Without escaping, a purchaser/visitor can inject arbitrary
// HTML/script into a gift card email sent to a third party's inbox
// (recipientEmail is fully attacker-chosen), or into their own
// verification/reset/contact-confirmation email. Applied to every
// user-supplied value used inside an `html:` template below — never needed in
// the plain-text bodies.
export function escapeHtml(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[ch],
  );
}

const isConfigured = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS);

// Distinguishes "not set up at all" from "partially set up" (e.g. host/user
// present but the password wasn't actually pasted into .env yet) — the
// latter is worth a clearer startup warning than a silent fall-through to
// dev-preview mode, since it usually means a deploy is one step away from
// working mail and nobody would otherwise notice until a customer complains
// an email never arrived. Never includes any credential value — only
// presence/absence — so this is safe to log or return from an API.
export function describeSmtpConfig() {
  const has = {
    host: Boolean(SMTP_HOST),
    port: Boolean(SMTP_PORT),
    user: Boolean(SMTP_USER),
    pass: Boolean(SMTP_PASS),
  };
  if (!has.host && !has.port && !has.user && !has.pass) {
    return {
      status: "unconfigured",
      message:
        "SMTP is not configured — transactional email is unavailable; verification codes/reset links use the local dev-preview fallback instead.",
    };
  }
  const missing = Object.entries(has)
    .filter(([, present]) => !present)
    .map(([key]) => key.toUpperCase());
  if (missing.length) {
    return {
      status: "partial",
      message: `SMTP is partially configured — missing SMTP_${missing.join(", SMTP_")}. Transactional email will not work until all of SMTP_HOST/PORT/USER/PASS are set.`,
    };
  }
  return {
    status: "configured",
    message: `SMTP is configured (host=${SMTP_HOST}, user=${SMTP_USER}).`,
  };
}

let transporter = null;
if (isConfigured) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    // Explicit SMTP_SECURE wins when set (Zoho: 465/true). Falls back to the
    // port-465-implies-TLS heuristic this file already used, so an existing
    // deployment that only ever set SMTP_PORT keeps working unchanged.
    secure:
      SMTP_SECURE !== undefined
        ? SMTP_SECURE === "true"
        : Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

// Backend-only, never exposed over HTTP — confirms the transporter can
// actually authenticate with the SMTP provider (distinct from "the env vars
// are present," which describeSmtpConfig() above already checks). Intended
// for a one-off manual check (see scripts/verify-smtp.mjs) or a startup log,
// never a request handler; the App Password never leaves this process.
export async function verifySmtpConnection() {
  if (!transporter) return { ok: false, reason: "unconfigured" };
  try {
    await transporter.verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "connection-failed", message: error.message };
  }
}

// Central sender identities — every send* function below picks one of these
// instead of a single hardcoded SMTP_FROM, so support/orders/admin mail
// reliably comes from the right alias. Each falls back through:
//   1. its own dedicated env var (SUPPORT_EMAIL / ORDERS_EMAIL / ADMIN_EMAIL)
//   2. the legacy single SMTP_FROM (email portion only, if it's a "Name <addr>" string)
//   3. SMTP_USER (the authenticated mailbox itself)
// so a deployment that hasn't set the new per-purpose vars yet (e.g. this
// project's own pre-Zoho SMTP_FROM-only setup) keeps sending exactly as
// before, while a Zoho setup with SUPPORT_EMAIL/ORDERS_EMAIL/ADMIN_EMAIL
// configured gets real per-alias routing. ADMIN_EMAIL here intentionally
// reuses the same var server/admin-config-guard.mjs and seed.mjs already use
// for the admin panel login account — in the target Zoho setup both are the
// same real mailbox (admin@urbanphoenix.am), so one var correctly serves
// both purposes rather than introducing a second name for the same address.
function extractEmail(fromHeader) {
  const match = String(fromHeader || "").match(/<([^>]+)>/);
  return (match ? match[1] : fromHeader || "").trim();
}
const legacyFallbackEmail = extractEmail(SMTP_FROM) || SMTP_USER;

export const EMAIL_SENDERS = {
  support: {
    name: "Urban Phoenix Support",
    email: SUPPORT_EMAIL || legacyFallbackEmail,
  },
  orders: {
    name: "Urban Phoenix Orders",
    email: ORDERS_EMAIL || legacyFallbackEmail,
  },
  admin: { name: "Urban Phoenix", email: ADMIN_EMAIL || legacyFallbackEmail },
};

function formatSender(key) {
  const sender = EMAIL_SENDERS[key];
  return sender?.email
    ? `${sender.name} <${sender.email}>`
    : legacyFallbackEmail;
}

export function getPublicUrl() {
  return (PUBLIC_URL || "http://localhost:4173").replace(/\/$/, "");
}

// Returns { sent: boolean, previewLink?: string } so callers can surface a dev-mode link
// when no SMTP provider is configured yet.
export async function sendVerificationCode({ to, name, code }) {
  if (!isConfigured) {
    console.log(
      "--------------------------------------------------------------",
    );
    console.log(`SMTP is not configured — email not actually sent.`);
    console.log(`Verification code for ${to}: ${code}`);
    console.log(
      "--------------------------------------------------------------",
    );
    return { sent: false, reason: "unconfigured", previewCode: code };
  }

  try {
    await transporter.sendMail({
      from: formatSender("support"),
      to,
      replyTo: EMAIL_SENDERS.support.email,
      subject: `${code} is your Urban Phoenix verification code`,
      text: `Hi ${name},\n\nYour verification code is: ${code}\n\nEnter this code on the site to activate your account. This code expires in 30 minutes.\n\n— Urban Phoenix`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="letter-spacing: 0.05em; text-transform: uppercase;">Urban Phoenix</h2>
          <p>Hi ${escapeHtml(name)},</p>
          <p>Enter this code on the site to activate your account:</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 0.15em; margin: 24px 0;">${code}</p>
          <p style="color:#666; font-size:13px;">This code expires in 30 minutes. If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (error) {
    // Deliberately does NOT include previewCode here — unlike the
    // `!isConfigured` branch above, this is a real, configured SMTP
    // provider that failed at send time (bad credentials, transient outage,
    // etc.). That's operationally different from "no SMTP provider on this
    // machine" and must never leak the actual verification code into an API
    // response, in any environment — see customer-auth.mjs's issueVerificationCode.
    console.error("Failed to send verification code:", error.message);
    console.log(`Verification code for ${to}: ${code}`);
    return { sent: false, reason: "send-failed" };
  }
}

export async function sendPasswordResetEmail({ to, name, link }) {
  if (!isConfigured) {
    console.log(
      "--------------------------------------------------------------",
    );
    console.log(`SMTP is not configured — email not actually sent.`);
    console.log(`Password reset link for ${to}:`);
    console.log(link);
    console.log(
      "--------------------------------------------------------------",
    );
    return { sent: false, reason: "unconfigured", previewLink: link };
  }

  try {
    await transporter.sendMail({
      from: formatSender("support"),
      to,
      replyTo: EMAIL_SENDERS.support.email,
      subject: "Reset your Urban Phoenix password",
      text: `Hi ${name},\n\nWe received a request to reset your password. Open this link to choose a new one:\n${link}\n\nThis link expires in 60 minutes. If you didn't request this, you can ignore this email — your password won't change.\n\n— Urban Phoenix`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="letter-spacing: 0.05em; text-transform: uppercase;">Urban Phoenix</h2>
          <p>Hi ${escapeHtml(name)},</p>
          <p>We received a request to reset your password.</p>
          <p style="margin: 24px 0;">
            <a href="${link}" style="background:#111; color:#fff; padding:12px 24px; text-decoration:none; text-transform:uppercase; letter-spacing:0.05em; font-size:13px;">
              Reset password
            </a>
          </p>
          <p style="color:#666; font-size:13px;">This link expires in 60 minutes. If you didn't request this, you can ignore this email — your password won't change.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (error) {
    // See the matching comment in sendVerificationCode() above — no
    // previewLink here. A configured-but-failing SMTP send must never
    // expose a live password-reset link through the API response.
    console.error("Failed to send password reset email:", error.message);
    console.log(`Password reset link for ${to}: ${link}`);
    return { sent: false, reason: "send-failed" };
  }
}

// Mirrors the frontend's formatMoney (src/context/AppContext.jsx) closely
// enough for email purposes: AMD has no minor unit, everything else shows
// two decimal places. Not imported directly — Intl.NumberFormat needs a
// fresh instance per currency and this file has no reason to share the
// frontend's currency list beyond the amount/symbol formatting itself.
function fmtGiftCardAmount(value, currency) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: currency === "AMD" ? 0 : 2,
    }).format(Number(value) || 0);
  } catch {
    return `${Number(value || 0).toFixed(2)} ${currency || "USD"}`;
  }
}

// The gift card "visual" embedded in the email — a nested table styled to
// read as a dark, premium physical/digital card rather than a plain text
// block, built entirely from table-safe inline CSS (no gradients, flexbox,
// or grid) so it survives Outlook/Gmail's HTML stripping. The code is real
// selectable text inside it, not an image, so it can be copied directly
// from the email body in any client.
function giftCardVisualHtml({ amountLabel, currency, code }) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#131110;border:1px solid #c65d1e;">
      <tr>
        <td style="padding:28px 28px 22px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:16px;letter-spacing:0.28em;color:#f5f5f3;">URBAN PHOENIX</td>
              <td align="right" style="font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.25em;color:#c65d1e;">GIFT CARD</td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:34px;">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:38px;letter-spacing:0.01em;color:#ffffff;">${escapeHtml(amountLabel)}</td>
            </tr>
            <tr>
              <td style="padding-top:2px;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.25em;color:#8a8a8a;">${escapeHtml(currency || "USD")} · COLLECTION 001</td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:30px;border-top:1px solid #2a2622;">
            <tr>
              <td style="padding-top:20px;font-family:Arial,Helvetica,sans-serif;font-size:9px;letter-spacing:0.25em;color:#8a8a8a;">GIFT CARD CODE</td>
            </tr>
            <tr>
              <td style="padding-top:8px;font-family:'Courier New',Courier,monospace;font-weight:700;font-size:22px;letter-spacing:0.12em;color:#ffffff;word-break:break-all;">${escapeHtml(code)}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

export async function sendGiftCardEmail({
  to,
  code,
  amount,
  currency = "USD",
  senderName,
  recipientName,
  message,
  purchaserEmail,
  subjectOverride,
}) {
  const amountLabel = fmtGiftCardAmount(amount, currency);
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  const fromLine = senderName
    ? `${senderName} sent you a gift card`
    : "You've received a gift card";
  const messageBlock = message ? `\n"${message}"\n` : "";
  const shopUrl = `${getPublicUrl()}/shop`;

  if (!isConfigured) {
    console.log(
      "--------------------------------------------------------------",
    );
    console.log(`SMTP is not configured — gift card email not actually sent.`);
    console.log(
      `Gift card code for ${to} (from ${purchaserEmail}): ${code} (${amountLabel})`,
    );
    console.log(
      "--------------------------------------------------------------",
    );
    return { sent: false, error: "SMTP is not configured." };
  }

  // HTML-safe counterparts of every purchaser-supplied field — recipientEmail
  // (and therefore who receives this email) is entirely attacker-chosen, so
  // this is one of the few emails in this file that can inject into a third
  // party's inbox rather than just the sender's own.
  const greetingHtml = recipientName
    ? `Hi ${escapeHtml(recipientName)},`
    : "Hi,";
  const fromLineHtml = senderName
    ? `${escapeHtml(senderName)} sent you a gift card`
    : "You've received a gift card";

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>You've received an Urban Phoenix gift card</title>
<style>
  @media only screen and (max-width: 520px) {
    .up-container { width: 100% !important; }
    .up-px { padding-left: 20px !important; padding-right: 20px !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#050505;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${fromLineHtml}, worth ${escapeHtml(amountLabel)}.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;">
    <tr>
      <td align="center" style="padding:36px 16px;">
        <table role="presentation" class="up-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#0a0a0a;border:1px solid #1e1e1e;">

          <!-- Wordmark -->
          <tr>
            <td class="up-px" align="center" style="padding:36px 32px 28px;border-bottom:1px solid #1e1e1e;">
              <span style="font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:22px;letter-spacing:0.32em;color:#f5f5f3;">URBAN PHOENIX</span>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td class="up-px" align="center" style="padding:40px 32px 4px;">
              <p style="margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.3em;text-transform:uppercase;color:#c65d1e;">Freedom To Become</p>
              <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#f5f5f3;">${greetingHtml}</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:26px;letter-spacing:0.02em;text-transform:uppercase;color:#f5f5f3;">${fromLineHtml}</p>
            </td>
          </tr>

          ${
            message
              ? `
          <!-- Personal message -->
          <tr>
            <td class="up-px" style="padding:22px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:2px solid #c65d1e;">
                <tr><td style="padding:4px 0 4px 16px;font-family:Arial,Helvetica,sans-serif;font-style:italic;font-size:14px;line-height:1.6;color:#c7c7c5;">"${escapeHtml(message)}"</td></tr>
              </table>
            </td>
          </tr>`
              : ""
          }

          <!-- Gift card visual -->
          <tr>
            <td class="up-px" style="padding:32px 32px 0;">
              ${giftCardVisualHtml({ amountLabel, currency, code })}
            </td>
          </tr>

          <!-- Redemption instructions -->
          <tr>
            <td class="up-px" align="center" style="padding:26px 32px 0;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#9a9a9a;">
                Enter the code above at checkout, under <strong style="color:#f5f5f3;">Gift Card Code</strong>, to redeem it.
                If your order total is less than the card balance, the remaining balance stays on the card for next time.
              </p>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:26px 32px 8px;">
              <a href="${shopUrl}" style="display:inline-block;background:#c65d1e;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;text-decoration:none;padding:15px 34px;">Shop Urban Phoenix</a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="up-px" align="center" style="padding:40px 32px 36px;">
              <p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.15em;text-transform:uppercase;color:#5c5c5c;">Questions about this gift card?</p>
              <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#9a9a9a;">Reply to this email or reach us anytime — we're here to help.</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:0.1em;color:#4a4a4a;">© ${new Date().getFullYear()} Urban Phoenix. Built from chaos. Built for the few.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const info = await transporter.sendMail({
      from: formatSender("orders"),
      to,
      replyTo: EMAIL_SENDERS.support.email,
      // subjectOverride exists only for test tooling to label a test send
      // distinctly (e.g. "— Real Template Test") — real purchases never
      // pass it, so this changes nothing about the actual customer subject.
      subject:
        subjectOverride || `${fromLine} — ${amountLabel} — Urban Phoenix`,
      text: `${greeting}\n\n${fromLine}, worth ${amountLabel}.\n${messageBlock}\nGift card code: ${code}\n\nEnter this code at checkout to redeem it.\n\n— Urban Phoenix`,
      html,
    });
    // Same shape of detail the SMTP transport actually reported back — kept
    // on the result (not just logged) so a caller like the admin
    // resend-email endpoint can surface real delivery diagnostics instead
    // of a bare true/false, the same way the standalone diagnostic script
    // that confirmed the transport itself works did.
    console.log(
      `Gift card email accepted by SMTP relay — messageId=${info.messageId} accepted=${JSON.stringify(info.accepted)} rejected=${JSON.stringify(info.rejected)} response="${info.response}"`,
    );
    return {
      sent: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
      response: info.response,
    };
  } catch (error) {
    console.error("Failed to send gift card email:", error.message);
    console.log(
      `Gift card code for ${to} (from ${purchaserEmail}): ${code} (${amountLabel})`,
    );
    return { sent: false, error: error.message };
  }
}

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const fmtMoney = (value) => currencyFmt.format(Number(value || 0));
const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

const PAYMENT_METHOD_LABELS = {
  cash: "Cash on delivery", // retired value — kept only so a historical order still renders sensibly
  cash_on_delivery: "Cash on Delivery",
  card: "Card",
  paypal: "PayPal",
  idram: "Idram",
  telcell: "Telcell",
};

const PAYMENT_STATUS_LABELS = {
  not_charged: "Not yet charged",
  paid: "Paid",
  refunded: "Refunded",
};

// Cash on Delivery orders are always 'not_charged' (no money has changed
// hands yet — see order-api.mjs's createOrder) but "Not yet charged" reads
// oddly for a customer who chose to pay in person; "Payment due on
// delivery" says exactly the same true thing in the context they expect.
// Never used to imply the order is paid.
function paymentStatusLabel(order) {
  if (
    order.paymentMethod === "cash_on_delivery" &&
    order.paymentStatus === "not_charged"
  ) {
    return "Payment due on delivery";
  }
  return PAYMENT_STATUS_LABELS[order.paymentStatus] || order.paymentStatus;
}

// Resolves the order's real selected delivery method (server/delivery.mjs —
// the same centralized module checkout priced the order from) rather than
// guessing from the shipping country, so the email always matches exactly
// what the customer picked and was charged. Falls back to a country-based
// description only for a historical order placed before delivery methods
// existed (deliveryMethod is null on those rows).
function deliveryMethodLabel(order) {
  if (order.deliveryMethod) {
    const method = getDeliveryMethod({
      id: order.deliveryMethod,
      country: order.customer.country,
      city: order.customer.city,
      subtotal: Number(order.subtotal),
    });
    if (method) {
      // order.deliveryEstimate is the exact estimate text this order was
      // actually shown/promised at checkout, snapshotted at commit time —
      // preferred over method.description (what delivery.mjs says right
      // now) so a later change to those stated estimates can never make an
      // already-placed order's email disagree with what the customer was
      // originally told. Only null for an order placed before that column
      // existed, where the freshly-resolved description is the best we have.
      return `${method.label} — ${order.deliveryEstimate || method.description}`;
    }
  }
  // No stored deliveryMethod at all — a historical order from before
  // customer-selectable delivery methods existed. Resolves the same
  // zone-aware (Yerevan vs. other Armenian regions vs. U.S.) estimate
  // delivery.mjs would give a fresh order today, rather than a separate,
  // hand-maintained copy of that logic here.
  const fallback = defaultDeliveryMethod({
    country: order.customer.country,
    city: order.customer.city,
    subtotal: Number(order.subtotal),
  });
  if (fallback) return `${fallback.label} — ${fallback.description}`;
  return Number(order.shipping) === 0
    ? "Free Standard Shipping"
    : "Standard Shipping";
}

// Editorial product row: larger, cleaner image, uppercase name, a single
// tracked meta line (COLOR · SIZE · QTY), price set apart on the right.
// Falls back to a small branded monogram tile (never an empty box) when a
// product has no image on record.
// Never recomputed — item.editionNumbers/editionTotal are the exact values
// order-api.mjs's claimEditions() assigned and saved onto this order at the
// moment it was placed, so this line can never drift from what the customer
// actually owns even if the product's config changes later.
function editionOwnershipLine(item) {
  if (!item.isLimitedEdition || !item.editionNumbers?.length) return "";
  const total = item.editionTotal || 100;
  const serials = item.editionNumbers.map(
    (number) =>
      `${String(number).padStart(3, "0")}/${String(total).padStart(3, "0")}`,
  );
  const text =
    serials.length > 1
      ? `Pieces ${serials.join(", ")} are yours.`
      : `Piece ${serials[0]} is yours.`;
  return `<p style="margin:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#e07a3a;">${escapeHtml(text)}</p>`;
}

function orderItemsHtml(order) {
  return order.items
    .map((item, index) => {
      const isLast = index === order.items.length - 1;
      const borderStyle = isLast ? "" : "border-bottom:1px solid #1c1c1c;";
      const imageCell = item.image
        ? `<img src="${escapeHtml(item.image)}" width="84" height="106" alt="${escapeHtml(item.name)}" style="display:block;width:84px;height:106px;object-fit:cover;background:#141414;border:1px solid #232323;" />`
        : `<table role="presentation" width="84" height="106" cellpadding="0" cellspacing="0" style="width:84px;height:106px;background:#141414;border:1px solid #232323;"><tr><td align="center" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.15em;color:#5c5c5c;">UP</td></tr></table>`;
      return `
      <tr>
        <td style="padding:22px 0;${borderStyle}" width="84">${imageCell}</td>
        <td style="padding:22px 0 22px 18px;${borderStyle}vertical-align:top;">
          <p style="margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.03em;text-transform:uppercase;color:#f5f5f3;">${escapeHtml(item.name)}</p>
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8a8a8a;">${escapeHtml(item.color)} &nbsp;·&nbsp; Size ${escapeHtml(item.size)} &nbsp;·&nbsp; Qty ${Number(item.quantity)}</p>
          ${editionOwnershipLine(item)}
        </td>
        <td style="padding:22px 0 22px 12px;${borderStyle}vertical-align:top;text-align:right;white-space:nowrap;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#f5f5f3;">${fmtMoney(item.lineTotal)}</p>
        </td>
      </tr>`;
    })
    .join("");
}

function summaryRow(label, value, { accent = false, strong = false } = {}) {
  const labelColor = strong ? "#8a8a8a" : accent ? "#e07a3a" : "#9a9a9a";
  const labelStyle = strong
    ? `font-size:11px;letter-spacing:0.2em;text-transform:uppercase;color:${labelColor};`
    : `font-size:13px;color:${labelColor};`;
  const valueStyle = strong
    ? "font-size:24px;font-weight:800;color:#f5f5f3;"
    : `font-size:13px;font-weight:400;color:${accent ? "#e07a3a" : "#f5f5f3"};`;
  return `
    <tr>
      <td style="padding:${strong ? "14px 0 0" : "6px 0"};font-family:Arial,Helvetica,sans-serif;${labelStyle}">${escapeHtml(label)}</td>
      <td style="padding:${strong ? "14px 0 0" : "6px 0"};font-family:Arial,Helvetica,sans-serif;${valueStyle}text-align:right;">${value}</td>
    </tr>`;
}

// `order` is the already-serialized shape from server/order-api.mjs's
// serializeOrder() (items carry resolved `.image`, all totals present) — the
// same object the storefront's own order-confirmation/tracking views render
// from, so this email can never drift from real order/product data.
export async function sendOrderConfirmationEmail({ order }) {
  const to = order.customer.email;
  const trackUrl = order.orderNumber
    ? `${getPublicUrl()}/track?order=${encodeURIComponent(order.orderNumber)}`
    : "";
  // Raster, not SVG (email-client compatibility) — a real, white, email-sized
  // export of the existing brand mark (public/images/brand/up-logo.png),
  // generated once at public/images/brand/up-logo-email-white.png so the
  // production-served asset (getPublicUrl() + this path) is what email
  // clients load; not an invented logo.
  const logoUrl = `${getPublicUrl()}/images/brand/up-logo-email-white.png`;
  const paymentLabel =
    PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod;
  const paymentStatusText = paymentStatusLabel(order);
  const delivery = deliveryMethodLabel(order);

  const textLines = [
    `ORDER CONFIRMED — Urban Phoenix`,
    ``,
    `Order #${order.orderNumber}`,
    `Placed ${fmtDate(order.createdAt)}`,
    ``,
    `Customer: ${order.customer.firstName} ${order.customer.lastName}`,
    ``,
    `Items:`,
    ...order.items.flatMap((item) => {
      const lines = [
        `  ${item.quantity}x ${item.name} (${item.color} / ${item.size}) — unit ${fmtMoney(item.unitPrice)} — line total ${fmtMoney(item.lineTotal)}`,
      ];
      if (item.isLimitedEdition && item.editionNumbers?.length) {
        const total = item.editionTotal || 100;
        const serials = item.editionNumbers.map(
          (n) =>
            `${String(n).padStart(3, "0")}/${String(total).padStart(3, "0")}`,
        );
        lines.push(
          serials.length > 1
            ? `    Pieces ${serials.join(", ")} are yours.`
            : `    Piece ${serials[0]} is yours.`,
        );
      }
      return lines;
    }),
    ``,
    `Subtotal: ${fmtMoney(order.subtotal)}`,
    order.discountAmount > 0
      ? `Discount${order.promoCode ? ` (${order.promoCode})` : ""}: -${fmtMoney(order.discountAmount)}`
      : null,
    order.giftCardAmount > 0
      ? `Gift card applied: -${fmtMoney(order.giftCardAmount)}`
      : null,
    order.loyaltyDiscount > 0
      ? `Rewards points applied: -${fmtMoney(order.loyaltyDiscount)}`
      : null,
    `Delivery: ${Number(order.shipping) === 0 ? "Free" : fmtMoney(order.shipping)}`,
    `Total: ${fmtMoney(order.total)}`,
    ``,
    `Shipping to:`,
    `${order.customer.firstName} ${order.customer.lastName}`,
    order.customer.apartment
      ? `${order.customer.address}, ${order.customer.apartment}`
      : order.customer.address,
    order.customer.postalCode
      ? `${order.customer.city}, ${order.customer.postalCode}`
      : order.customer.city,
    getCountryName(order.customer.country),
    order.customer.deliveryNotes
      ? `Delivery notes: ${order.customer.deliveryNotes}`
      : null,
    ``,
    `Delivery method: ${delivery}`,
    `Payment method: ${paymentLabel}`,
    `Payment status: ${paymentStatusText}`,
    ``,
    `Track your order: ${trackUrl}`,
    ``,
    `— Urban Phoenix`,
  ]
    .filter((line) => line !== null)
    .join("\n");

  const discountRows = [
    order.discountAmount > 0
      ? summaryRow(
          `Discount${order.promoCode ? ` (${order.promoCode})` : ""}`,
          `-${fmtMoney(order.discountAmount)}`,
          { accent: true },
        )
      : "",
    order.giftCardAmount > 0
      ? summaryRow("Gift card applied", `-${fmtMoney(order.giftCardAmount)}`, {
          accent: true,
        })
      : "",
    order.loyaltyDiscount > 0
      ? summaryRow(
          "Rewards points applied",
          `-${fmtMoney(order.loyaltyDiscount)}`,
          { accent: true },
        )
      : "",
  ].join("");

  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>Order Confirmed — Urban Phoenix</title>
<style>
  @media only screen and (max-width: 520px) {
    .up-container { width: 100% !important; }
    .up-px { padding-left: 22px !important; padding-right: 22px !important; }
    .up-hero { font-size: 34px !important; }
    .up-logo { height: 56px !important; width: auto !important; }
    .up-stack-td { display: block !important; width: 100% !important; padding-left: 0 !important; padding-right: 0 !important; }
    .up-stack-gap { display: block !important; height: 22px !important; line-height: 22px !important; font-size: 0 !important; }
    .up-cta { display: block !important; width: 100% !important; box-sizing: border-box !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#050505;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Your Urban Phoenix order ${escapeHtml(order.orderNumber)} is confirmed — thank you for your purchase.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" class="up-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#0a0a0a;border:1px solid #1c1c1c;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:40px 32px 0;">
              <img src="${logoUrl}" alt="Urban Phoenix" width="79" height="72" class="up-logo" style="display:block;height:72px;width:79px;border:0;outline:none;" />
            </td>
          </tr>

          <!-- Eyebrow -->
          <tr>
            <td align="center" style="padding:22px 32px 0;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.32em;text-transform:uppercase;color:#c65d1e;">Order Confirmation &nbsp;/&nbsp; UP-26</p>
            </td>
          </tr>

          <!-- Headline -->
          <tr>
            <td class="up-px" align="center" style="padding:18px 32px 0;">
              <p class="up-hero" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:42px;line-height:0.98;letter-spacing:0.01em;text-transform:uppercase;color:#f5f5f3;">Order<br />Confirmed</p>
            </td>
          </tr>

          <!-- Subhead -->
          <tr>
            <td class="up-px" align="center" style="padding:20px 48px 0;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:#9a9a9a;">Thank you for your order.<br />Your Urban Phoenix piece is now confirmed.</p>
            </td>
          </tr>

          <!-- Order # / date -->
          <tr>
            <td align="center" style="padding:22px 32px 0;">
              <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;letter-spacing:0.06em;color:#f5f5f3;">ORDER #${escapeHtml(order.orderNumber)}</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.08em;color:#6a6a6a;">${escapeHtml(fmtDate(order.createdAt))}</p>
            </td>
          </tr>

          <!-- Brand tagline, flanked by hairlines -->
          <tr>
            <td class="up-px" style="padding:30px 56px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="50%" style="border-top:1px solid #232323;font-size:0;line-height:0;">&nbsp;</td>
                  <td style="white-space:nowrap;padding:0 14px;font-family:Arial,Helvetica,sans-serif;font-size:9px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:#6a6a6a;">Freedom To Become</td>
                  <td width="50%" style="border-top:1px solid #232323;font-size:0;line-height:0;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          ${
            trackUrl
              ? `
          <!-- CTA -->
          <tr>
            <td align="center" style="padding:28px 32px 0;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" class="up-cta" style="background:#c65d1e;">
                    <a href="${trackUrl}" style="display:block;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;text-decoration:none;padding:16px 42px;">View / Track Order</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`
              : ""
          }

          <!-- Items -->
          <tr>
            <td class="up-px" style="padding:44px 32px 0;">
              <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.26em;text-transform:uppercase;color:#c65d1e;border-bottom:1px solid #1c1c1c;padding-bottom:14px;">Your Items</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;">
                ${orderItemsHtml(order)}
              </table>
            </td>
          </tr>

          <!-- Totals -->
          <tr>
            <td class="up-px" style="padding:6px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;">
                ${summaryRow("Subtotal", fmtMoney(order.subtotal))}
                ${discountRows}
                ${summaryRow("Delivery", Number(order.shipping) === 0 ? "Free" : fmtMoney(order.shipping))}
                <tr><td colspan="2" style="padding-top:14px;border-top:1px solid #1c1c1c;"></td></tr>
                ${summaryRow("Total", fmtMoney(order.total), { strong: true })}
              </table>
            </td>
          </tr>

          <!-- Delivery + payment -->
          <tr>
            <td class="up-px" style="padding:40px 32px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td class="up-stack-td" width="50%" valign="top" style="font-family:Arial,Helvetica,sans-serif;padding-right:16px;">
                    <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:#c65d1e;">Delivery</p>
                    <p style="margin:0;font-size:13px;line-height:1.7;color:#f5f5f3;">
                      ${escapeHtml(order.customer.firstName)} ${escapeHtml(order.customer.lastName)}<br />
                      ${escapeHtml(order.customer.address)}${order.customer.apartment ? `, ${escapeHtml(order.customer.apartment)}` : ""}<br />
                      ${escapeHtml(order.customer.city)}${order.customer.postalCode ? `, ${escapeHtml(order.customer.postalCode)}` : ""}<br />
                      ${escapeHtml(getCountryName(order.customer.country))}
                    </p>
                    <p style="margin:12px 0 0;font-size:12px;line-height:1.6;color:#8a8a8a;">${escapeHtml(delivery)}</p>
                    ${order.customer.deliveryNotes ? `<p style="margin:8px 0 0;font-size:12px;line-height:1.6;color:#8a8a8a;">Notes: ${escapeHtml(order.customer.deliveryNotes)}</p>` : ""}
                  </td>
                  <td class="up-stack-gap" width="0" style="font-size:0;line-height:0;">&nbsp;</td>
                  <td class="up-stack-td" width="50%" valign="top" style="font-family:Arial,Helvetica,sans-serif;padding-left:16px;">
                    <p style="margin:0 0 10px;font-size:10px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:#c65d1e;">Payment</p>
                    <p style="margin:0;font-size:13px;line-height:1.7;color:#f5f5f3;">${escapeHtml(paymentLabel)}</p>
                    <p style="margin:4px 0 0;font-size:12px;line-height:1.6;color:#8a8a8a;">${escapeHtml(paymentStatusText)}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="up-px" align="center" style="padding:48px 32px 40px;">
              <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-weight:900;font-size:13px;letter-spacing:0.3em;color:#5c5c5c;">URBAN PHOENIX</p>
              <p style="margin:0 0 4px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#5c5c5c;">Questions about your order?</p>
              <p style="margin:0 0 22px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#9a9a9a;">Reply to this email or contact us — we're here to help.</p>
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#454545;">© ${new Date(order.createdAt).getUTCFullYear()} Urban Phoenix — Built From Chaos. Built For The Few.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  if (!isConfigured) {
    console.log(
      "--------------------------------------------------------------",
    );
    console.log(
      `SMTP is not configured — order confirmation email not actually sent.`,
    );
    console.log(`Order confirmation for ${to}: #${order.orderNumber}`);
    console.log(
      "--------------------------------------------------------------",
    );
    return { sent: false };
  }

  try {
    await transporter.sendMail({
      from: formatSender("orders"),
      to,
      replyTo: EMAIL_SENDERS.support.email,
      subject: `Urban Phoenix — Order #${order.orderNumber} Confirmed`,
      text: textLines,
      html,
    });
    return { sent: true };
  } catch (error) {
    // The order itself is already committed to the database by this point
    // (server/order-api.mjs only calls this after the INSERT succeeds) — a
    // failed email must never look like a failed order, so this only logs
    // for debugging and returns a normal { sent: false } result rather than
    // throwing.
    console.error(
      `Failed to send order confirmation email for order ${order.orderNumber}:`,
      error.message,
    );
    return { sent: false, error: error.message };
  }
}

export async function sendVerificationEmail({ to, name, link }) {
  if (!isConfigured) {
    console.log(
      "--------------------------------------------------------------",
    );
    console.log(`SMTP is not configured — email not actually sent.`);
    console.log(`Verification link for ${to}:`);
    console.log(link);
    console.log(
      "--------------------------------------------------------------",
    );
    return { sent: false, reason: "unconfigured", previewLink: link };
  }

  try {
    await transporter.sendMail({
      from: formatSender("support"),
      to,
      replyTo: EMAIL_SENDERS.support.email,
      subject: "Verify your Urban Phoenix account",
      text: `Hi ${name},\n\nPlease verify your email address by opening this link:\n${link}\n\nThis link expires in 24 hours.\n\n— Urban Phoenix`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="letter-spacing: 0.05em; text-transform: uppercase;">Urban Phoenix</h2>
          <p>Hi ${escapeHtml(name)},</p>
          <p>Please verify your email address to activate your account.</p>
          <p style="margin: 24px 0;">
            <a href="${link}" style="background:#111; color:#fff; padding:12px 24px; text-decoration:none; text-transform:uppercase; letter-spacing:0.05em; font-size:13px;">
              Verify email
            </a>
          </p>
          <p style="color:#666; font-size:13px;">This link expires in 24 hours. If you didn't create this account, you can ignore this email.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (error) {
    console.error("Failed to send verification email:", error.message);
    console.log(`Verification link for ${to}: ${link}`);
    return { sent: false, reason: "send-failed" };
  }
}

// Notifies support@ that a visitor submitted the contact form. `replyTo` is
// the customer's own address (never `from`) so a Zoho reply lands straight in
// the customer's inbox without spoofing their domain — see server/contact-api.mjs
// for the validation/sanitization this relies on before values ever reach here.
export async function sendContactNotificationEmail({
  name,
  email,
  topic,
  message,
}) {
  if (!isConfigured) {
    console.log(
      "--------------------------------------------------------------",
    );
    console.log(
      "SMTP is not configured — contact form email not actually sent.",
    );
    console.log(`From: ${name} <${email}> — Topic: ${topic}`);
    console.log(message);
    console.log(
      "--------------------------------------------------------------",
    );
    return { sent: false, reason: "unconfigured" };
  }

  try {
    await transporter.sendMail({
      from: formatSender("support"),
      to: EMAIL_SENDERS.support.email,
      replyTo: email,
      subject: `[Contact] ${topic} — ${name}`,
      text: `New contact form submission\n\nName: ${name}\nEmail: ${email}\nTopic: ${topic}\n\nMessage:\n${message}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto;">
          <h2 style="letter-spacing: 0.05em; text-transform: uppercase;">New contact form submission</h2>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>
          <p><strong>Topic:</strong> ${escapeHtml(topic)}</p>
          <p><strong>Message:</strong></p>
          <p style="white-space: pre-wrap; border-left: 3px solid #111; padding-left: 12px;">${escapeHtml(message)}</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (error) {
    console.error("Failed to send contact notification email:", error.message);
    return { sent: false, reason: "send-failed" };
  }
}

// Confirms receipt to the customer who submitted the contact form. This is a
// courtesy send — its failure must never surface as a contact-form failure to
// the visitor, since the notification to support@ above is the send that
// actually matters and has already been attempted/logged by the time this runs.
export async function sendContactConfirmationEmail({ name, email, topic }) {
  if (!isConfigured) return { sent: false, reason: "unconfigured" };

  try {
    await transporter.sendMail({
      from: formatSender("support"),
      to: email,
      replyTo: EMAIL_SENDERS.support.email,
      subject: "We received your message — Urban Phoenix",
      text: `Hi ${name},\n\nThanks for reaching out about "${topic}" — our support team has received your message and will get back to you shortly.\n\n— Urban Phoenix Support`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="letter-spacing: 0.05em; text-transform: uppercase;">Urban Phoenix</h2>
          <p>Hi ${escapeHtml(name)},</p>
          <p>Thanks for reaching out about <strong>${escapeHtml(topic)}</strong> — our support team has received your message and will get back to you shortly.</p>
          <p style="color:#666; font-size:13px;">— Urban Phoenix Support</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (error) {
    console.error("Failed to send contact confirmation email:", error.message);
    return { sent: false, reason: "send-failed" };
  }
}

// Order lifecycle status-change emails (shipped / cancelled / refunded), sent
// from orders@. Called by server/order-api.mjs's updateOrderStatus() only when
// the status/paymentStatus actually transitions, so admin re-saving the same
// status (or a retried request) never produces a duplicate email — mirrors the
// existing `existing.status !== status` duplicate-prevention guard already used
// there for loyalty/stock reversal.
export async function sendOrderStatusEmail({ order, event }) {
  const to = order.customerEmail;
  if (!to) return { sent: false, reason: "no-recipient" };

  const copy = {
    shipped: {
      subject: `Your order has shipped — #${order.orderNumber} — Urban Phoenix`,
      heading: "Your order has shipped",
      body: `Great news — order #${order.orderNumber} is on its way.`,
    },
    cancelled: {
      subject: `Order cancelled — #${order.orderNumber} — Urban Phoenix`,
      heading: "Your order was cancelled",
      body: `Order #${order.orderNumber} has been cancelled. If you didn't request this, please contact support.`,
    },
    refunded: {
      subject: `Refund issued — #${order.orderNumber} — Urban Phoenix`,
      heading: "Your refund has been issued",
      body: `A refund for order #${order.orderNumber} has been issued and should appear on your original payment method shortly.`,
    },
  }[event];
  if (!copy) return { sent: false, reason: "unknown-event" };

  if (!isConfigured) {
    console.log(
      "--------------------------------------------------------------",
    );
    console.log(
      `SMTP is not configured — order ${event} email not actually sent.`,
    );
    console.log(`Order #${order.orderNumber} → ${to}`);
    console.log(
      "--------------------------------------------------------------",
    );
    return { sent: false, reason: "unconfigured" };
  }

  try {
    await transporter.sendMail({
      from: formatSender("orders"),
      to,
      replyTo: EMAIL_SENDERS.support.email,
      subject: copy.subject,
      text: `Hi ${order.customerFirstName || ""},\n\n${copy.body}\n\nQuestions? Reply to this email or contact ${EMAIL_SENDERS.support.email}.\n\n— Urban Phoenix`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="letter-spacing: 0.05em; text-transform: uppercase;">${escapeHtml(copy.heading)}</h2>
          <p>Hi ${escapeHtml(order.customerFirstName || "")},</p>
          <p>${escapeHtml(copy.body)}</p>
          <p style="color:#666; font-size:13px;">Questions? Reply to this email or contact ${escapeHtml(EMAIL_SENDERS.support.email)}.</p>
        </div>
      `,
    });
    return { sent: true };
  } catch (error) {
    console.error(
      `Failed to send order ${event} email for order ${order.orderNumber}:`,
      error.message,
    );
    return { sent: false, reason: "send-failed", error: error.message };
  }
}
