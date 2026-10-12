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

// Every send in this file goes through deliver(): it treats a recipient the
// SMTP server rejected as a failure (not just a thrown error), and if the
// provider refuses the From alias (Zoho only lets a mailbox send as itself or
// a configured alias — e.g. support@/orders@ that were never added as aliases
// of SMTP_USER), it retries once from the authenticated mailbox so the
// customer still gets the email. Never throws.
const SENDER_REFUSED = /(553|550 5\.7|5\.7\.1|not allowed|relay|sender|from address|unauthori[sz]ed)/i;

async function deliver(mail, label) {
  if (!transporter) return { sent: false, reason: "unconfigured", error: "SMTP is not configured." };
  const attempt = async (message) => {
    const info = await transporter.sendMail(message);
    const rejected = info.rejected || [];
    if (rejected.length) throw Object.assign(new Error(`Recipient rejected: ${rejected.join(", ")} (${info.response})`), { recipientRejected: true });
    console.log(`[mail] ${label} → ${message.to} accepted (messageId=${info.messageId}, response="${info.response}")`);
    return { sent: true, messageId: info.messageId, accepted: info.accepted, rejected, response: info.response, from: message.from };
  };
  try {
    return await attempt(mail);
  } catch (error) {
    const fromEmail = extractEmail(mail.from);
    if (!error.recipientRejected && SMTP_USER && fromEmail && fromEmail.toLowerCase() !== SMTP_USER.toLowerCase() && SENDER_REFUSED.test(error.message)) {
      console.warn(`[mail] ${label}: provider refused sender ${fromEmail} (${error.message}) — retrying from ${SMTP_USER}. Add ${fromEmail} as an alias of ${SMTP_USER} in Zoho to send from it.`);
      try {
        const name = String(mail.from).replace(/\s*<[^>]*>\s*$/, "").trim() || "Urban Phoenix";
        return await attempt({ ...mail, from: `${name} <${SMTP_USER}>` });
      } catch (retryError) {
        console.error(`[mail] ${label} → ${mail.to} FAILED after sender fallback: ${retryError.message}`);
        return { sent: false, reason: "send-failed", error: retryError.message };
      }
    }
    console.error(`[mail] ${label} → ${mail.to} FAILED: ${error.message}`);
    return { sent: false, reason: "send-failed", error: error.message };
  }
}

const FONT = "Arial,Helvetica,sans-serif";

// Branded, mobile-friendly shell shared by every transactional email — the
// same visual language as the order confirmation below (dark canvas, white
// logo, burnt-orange accents, uppercase display headline, table-only layout
// with inline CSS so it survives Gmail/Outlook). `bodyHtml` must already be
// escaped by the caller.
function brandedEmail({ preheader = "", eyebrow = "", heading = "", bodyHtml = "", cta = null, note = "" }) {
  const logoUrl = `${getPublicUrl()}/images/brand/up-logo-email-white.png`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="dark" />
<title>${escapeHtml(heading || "Urban Phoenix")}</title>
<style>
  @media only screen and (max-width: 520px) {
    .up-container { width: 100% !important; }
    .up-px { padding-left: 22px !important; padding-right: 22px !important; }
    .up-hero { font-size: 30px !important; }
    .up-cta { display: block !important; width: 100% !important; box-sizing: border-box !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:#050505;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050505;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" class="up-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#0a0a0a;border:1px solid #1c1c1c;">
          <tr>
            <td align="center" style="padding:40px 32px 0;">
              <img src="${logoUrl}" alt="Urban Phoenix" width="66" height="60" style="display:block;height:60px;width:66px;border:0;outline:none;" />
            </td>
          </tr>
          ${eyebrow ? `<tr><td align="center" style="padding:22px 32px 0;"><p style="margin:0;font-family:${FONT};font-size:10px;font-weight:700;letter-spacing:0.32em;text-transform:uppercase;color:#c65d1e;">${escapeHtml(eyebrow)}</p></td></tr>` : ""}
          ${heading ? `<tr><td class="up-px" align="center" style="padding:16px 32px 0;"><p class="up-hero" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-weight:700;font-size:36px;line-height:1.02;letter-spacing:0.01em;text-transform:uppercase;color:#f5f5f3;">${escapeHtml(heading)}</p></td></tr>` : ""}
          <tr>
            <td class="up-px" style="padding:26px 48px 0;font-family:${FONT};font-size:14px;line-height:1.7;color:#b5b5b3;">
              ${bodyHtml}
            </td>
          </tr>
          ${cta ? `<tr><td align="center" style="padding:30px 32px 0;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" class="up-cta" style="background:#c65d1e;"><a href="${escapeHtml(cta.url)}" style="display:block;color:#ffffff;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;text-decoration:none;padding:16px 42px;">${escapeHtml(cta.label)}</a></td></tr></table></td></tr>` : ""}
          ${note ? `<tr><td class="up-px" align="center" style="padding:26px 48px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:#6a6a6a;">${note}</td></tr>` : ""}
          <tr>
            <td class="up-px" style="padding:36px 56px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td width="50%" style="border-top:1px solid #232323;font-size:0;line-height:0;">&nbsp;</td>
                <td style="white-space:nowrap;padding:0 14px;font-family:${FONT};font-size:9px;font-weight:700;letter-spacing:0.28em;text-transform:uppercase;color:#6a6a6a;">Freedom To Become</td>
                <td width="50%" style="border-top:1px solid #232323;font-size:0;line-height:0;">&nbsp;</td>
              </tr></table>
            </td>
          </tr>
          <tr>
            <td class="up-px" align="center" style="padding:28px 32px 40px;">
              <p style="margin:0 0 14px;font-family:${FONT};font-weight:900;font-size:13px;letter-spacing:0.3em;color:#5c5c5c;">URBAN PHOENIX</p>
              <p style="margin:0 0 18px;font-family:${FONT};font-size:12px;color:#8a8a8a;">Questions? Reply to this email or write to <a href="mailto:${escapeHtml(EMAIL_SENDERS.support.email || "")}" style="color:#c65d1e;text-decoration:none;">${escapeHtml(EMAIL_SENDERS.support.email || "")}</a></p>
              <p style="margin:0;font-family:${FONT};font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:#454545;">© ${new Date().getFullYear()} Urban Phoenix — Built From Chaos. Built For The Few.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const para = (html) => `<p style="margin:0 0 14px;">${html}</p>`;

// Returns { sent: boolean, previewLink?: string } so callers can surface a dev-mode link
// when no SMTP provider is configured yet.
export async function sendVerificationCode({ to, name, code }) {
  if (!isConfigured) {
    console.log("--------------------------------------------------------------");
    console.log(`SMTP is not configured — email not actually sent.`);
    console.log(`Verification code for ${to}: ${code}`);
    console.log("--------------------------------------------------------------");
    return { sent: false, reason: "unconfigured", previewCode: code };
  }
  // Deliberately never includes previewCode on failure — a configured SMTP
  // provider that failed must never leak the code into an API response (see
  // customer-auth.mjs's issueVerificationCode).
  return deliver({
    from: formatSender("support"),
    to,
    replyTo: EMAIL_SENDERS.support.email,
    subject: `${code} is your Urban Phoenix verification code`,
    text: `Hi ${name},\n\nWelcome to Urban Phoenix. Your verification code is: ${code}\n\nEnter this code on the site to activate your account. It expires in 30 minutes.\n\nIf you didn't create an account, you can ignore this email.\n\n— Urban Phoenix`,
    html: brandedEmail({
      preheader: `Your verification code is ${code}`,
      eyebrow: "Account Registration",
      heading: "Confirm your email",
      bodyHtml: `${para(`Hi ${escapeHtml(name)},`)}${para("Welcome to Urban Phoenix. Enter this code on the site to activate your account:")}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 18px;"><tr><td align="center" style="background:#131110;border:1px solid #c65d1e;padding:22px 10px;font-family:'Courier New',Courier,monospace;font-size:34px;font-weight:700;letter-spacing:0.3em;color:#ffffff;">${escapeHtml(code)}</td></tr></table>`,
      note: "This code expires in 30 minutes. If you didn't create an account, you can safely ignore this email.",
    }),
  }, "verification code");
}

export async function sendPasswordResetEmail({ to, name, link }) {
  if (!isConfigured) {
    console.log("--------------------------------------------------------------");
    console.log(`SMTP is not configured — email not actually sent.`);
    console.log(`Password reset link for ${to}:`);
    console.log(link);
    console.log("--------------------------------------------------------------");
    return { sent: false, reason: "unconfigured", previewLink: link };
  }
  // No previewLink on failure — a configured-but-failing send must never
  // expose a live reset link through the API response.
  return deliver({
    from: formatSender("support"),
    to,
    replyTo: EMAIL_SENDERS.support.email,
    subject: "Reset your Urban Phoenix password",
    text: `Hi ${name},\n\nWe received a request to reset your password. Open this link to choose a new one:\n${link}\n\nThis link expires in 60 minutes. If you didn't request this, you can ignore this email — your password won't change.\n\n— Urban Phoenix`,
    html: brandedEmail({
      preheader: "Choose a new password for your Urban Phoenix account.",
      eyebrow: "Password Reset",
      heading: "Reset your password",
      bodyHtml: `${para(`Hi ${escapeHtml(name)},`)}${para("We received a request to reset the password for your Urban Phoenix account. Tap the button below to choose a new one.")}`,
      cta: { url: link, label: "Reset Password" },
      note: `This link expires in 60 minutes. If you didn't request a reset, you can ignore this email — your password won't change.<br /><br /><span style="color:#4a4a4a;word-break:break-all;">${escapeHtml(link)}</span>`,
    }),
  }, "password reset");
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
                Add the code above in your bag, under <strong style="color:#f5f5f3;">Gift Card</strong>, before checkout to redeem it.
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

  const result = await deliver({
    from: formatSender("orders"),
    to,
    replyTo: EMAIL_SENDERS.support.email,
    // subjectOverride exists only for test tooling to label a test send
    // distinctly — real purchases never pass it.
    subject: subjectOverride || `${fromLine} — ${amountLabel} — Urban Phoenix`,
    text: `${greeting}\n\n${fromLine}, worth ${amountLabel}.\n${messageBlock}\nGift card code: ${code}\n\nAdd this code in your bag (Gift Card field) before checkout to redeem it.\n\n— Urban Phoenix`,
    html,
  }, "gift card");
  if (!result.sent) console.log(`Gift card code for ${to} (from ${purchaserEmail}): ${code} (${amountLabel})`);
  return result;
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

  // The order is already committed by the time this runs — deliver() never
  // throws, so a failed email can never look like a failed order.
  return deliver({
    from: formatSender("orders"),
    to,
    replyTo: EMAIL_SENDERS.support.email,
    subject: `Urban Phoenix — Order #${order.orderNumber} Confirmed`,
    text: textLines,
    html,
  }, `order confirmation (#${order.orderNumber})`);
}

export async function sendVerificationEmail({ to, name, link }) {
  if (!isConfigured) {
    console.log("--------------------------------------------------------------");
    console.log(`SMTP is not configured — email not actually sent.`);
    console.log(`Verification link for ${to}:`);
    console.log(link);
    console.log("--------------------------------------------------------------");
    return { sent: false, reason: "unconfigured", previewLink: link };
  }
  return deliver({
    from: formatSender("support"),
    to,
    replyTo: EMAIL_SENDERS.support.email,
    subject: "Verify your Urban Phoenix account",
    text: `Hi ${name},\n\nPlease verify your email address by opening this link:\n${link}\n\nThis link expires in 24 hours.\n\n— Urban Phoenix`,
    html: brandedEmail({
      preheader: "Verify your email to activate your account.",
      eyebrow: "Account Registration",
      heading: "Verify your email",
      bodyHtml: `${para(`Hi ${escapeHtml(name)},`)}${para("Please verify your email address to activate your Urban Phoenix account.")}`,
      cta: { url: link, label: "Verify Email" },
      note: "This link expires in 24 hours. If you didn't create this account, you can ignore this email.",
    }),
  }, "verification link");
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
    console.log("--------------------------------------------------------------");
    console.log("SMTP is not configured — contact form email not actually sent.");
    console.log(`From: ${name} <${email}> — Topic: ${topic}`);
    console.log(message);
    console.log("--------------------------------------------------------------");
    return { sent: false, reason: "unconfigured" };
  }
  return deliver({
    from: formatSender("support"),
    to: EMAIL_SENDERS.support.email,
    replyTo: email,
    subject: `[Contact] ${topic} — ${name}`,
    text: `New contact form submission\n\nName: ${name}\nEmail: ${email}\nTopic: ${topic}\n\nMessage:\n${message}`,
    html: brandedEmail({
      preheader: `${name}: ${topic}`,
      eyebrow: "Contact Form",
      heading: "New message",
      bodyHtml: `${para(`<strong style="color:#f5f5f3;">Name:</strong> ${escapeHtml(name)}<br /><strong style="color:#f5f5f3;">Email:</strong> ${escapeHtml(email)}<br /><strong style="color:#f5f5f3;">Topic:</strong> ${escapeHtml(topic)}`)}
        <p style="margin:0;white-space:pre-wrap;border-left:2px solid #c65d1e;padding-left:14px;color:#f5f5f3;">${escapeHtml(message)}</p>`,
      note: "Reply to this email to answer the customer directly.",
    }),
  }, "contact notification");
}

// Confirms receipt to the customer who submitted the contact form. This is a
// courtesy send — its failure must never surface as a contact-form failure to
// the visitor, since the notification to support@ above is the send that
// actually matters and has already been attempted/logged by the time this runs.
export async function sendContactConfirmationEmail({ name, email, topic }) {
  if (!isConfigured) return { sent: false, reason: "unconfigured" };
  return deliver({
    from: formatSender("support"),
    to: email,
    replyTo: EMAIL_SENDERS.support.email,
    subject: "We received your message — Urban Phoenix",
    text: `Hi ${name},\n\nThanks for reaching out about "${topic}" — our support team has received your message and will get back to you shortly.\n\n— Urban Phoenix Support`,
    html: brandedEmail({
      preheader: "Our support team has received your message.",
      eyebrow: "Support",
      heading: "Message received",
      bodyHtml: `${para(`Hi ${escapeHtml(name)},`)}${para(`Thanks for reaching out about <strong style="color:#f5f5f3;">${escapeHtml(topic)}</strong>. Our support team has received your message and will get back to you shortly.`)}`,
    }),
  }, "contact confirmation");
}

// Order lifecycle status-change emails (shipped / cancelled / refunded), sent
// from orders@. Called by server/order-api.mjs's updateOrderStatus() only when
// the status/paymentStatus actually transitions, so admin re-saving the same
// status (or a retried request) never produces a duplicate email — mirrors the
// existing `existing.status !== status` duplicate-prevention guard already used
// there for loyalty/stock reversal.
export async function sendOrderStatusEmail({ order, event }) {
  const to = order.customerEmail || order.customer?.email;
  if (!to) return { sent: false, reason: "no-recipient" };
  const firstName = order.customerFirstName || order.customer?.firstName || "";
  const num = order.orderNumber;
  const trackUrl = `${getPublicUrl()}/track?order=${encodeURIComponent(num)}`;

  const copy = {
    confirmed: {
      subject: `Order confirmed — #${num} — Urban Phoenix`,
      eyebrow: "Order Confirmed",
      heading: "Your order is confirmed",
      body: `Order #${num} is confirmed and is now being prepared. We'll email you again as soon as it ships.`,
    },
    shipped: {
      subject: `Your order has shipped — #${num} — Urban Phoenix`,
      eyebrow: "Order Shipped",
      heading: "Your order is on its way",
      body: `Great news — order #${num} has left our studio and is on its way to you.`,
    },
    delivered: {
      subject: `Your order was delivered — #${num} — Urban Phoenix`,
      eyebrow: "Order Delivered",
      heading: "Your order has arrived",
      body: `Order #${num} has been delivered. We hope you love your new Urban Phoenix piece. If anything isn't right, reply to this email and we'll help.`,
    },
    cancelled: {
      subject: `Order cancelled — #${num} — Urban Phoenix`,
      eyebrow: "Order Cancelled",
      heading: "Your order was cancelled",
      body: `Order #${num} has been cancelled. If you didn't request this, please reply to this email and we'll look into it.`,
    },
    refunded: {
      subject: `Refund issued — #${num} — Urban Phoenix`,
      eyebrow: "Refund Issued",
      heading: "Your refund is on its way",
      body: `A refund for order #${num} has been issued and should appear on your original payment method shortly.`,
    },
  }[event];
  if (!copy) return { sent: false, reason: "unknown-event" };

  if (!isConfigured) {
    console.log("--------------------------------------------------------------");
    console.log(`SMTP is not configured — order ${event} email not actually sent.`);
    console.log(`Order #${num} → ${to}`);
    console.log("--------------------------------------------------------------");
    return { sent: false, reason: "unconfigured" };
  }

  return deliver({
    from: formatSender("orders"),
    to,
    replyTo: EMAIL_SENDERS.support.email,
    subject: copy.subject,
    text: `Hi ${firstName},\n\n${copy.body}\n\nTrack your order: ${trackUrl}\n\nQuestions? Reply to this email or contact ${EMAIL_SENDERS.support.email}.\n\n— Urban Phoenix`,
    html: brandedEmail({
      preheader: copy.body,
      eyebrow: copy.eyebrow,
      heading: copy.heading,
      bodyHtml: `${para(`Hi ${escapeHtml(firstName)},`)}${para(escapeHtml(copy.body))}${para(`<span style="font-size:12px;letter-spacing:0.12em;color:#f5f5f3;">ORDER #${escapeHtml(num)}</span>`)}`,
      cta: event === "cancelled" || event === "refunded" ? null : { url: trackUrl, label: "Track Order" },
    }),
  }, `order ${event} (#${num})`);
}

// Sent once an account's email is verified (customer-auth.mjs's verifyCode)
// — the verification-code email is the registration confirmation itself;
// this is the welcome that follows a successful sign-up.
export async function sendWelcomeEmail({ to, name }) {
  if (!isConfigured) return { sent: false, reason: "unconfigured" };
  const shopUrl = `${getPublicUrl()}/shop`;
  return deliver({
    from: formatSender("support"),
    to,
    replyTo: EMAIL_SENDERS.support.email,
    subject: "Welcome to Urban Phoenix",
    text: `Hi ${name},\n\nYour Urban Phoenix account is ready. Track orders, save your addresses and wishlist, and be first to know about new drops.\n\nShop now: ${shopUrl}\n\n— Urban Phoenix`,
    html: brandedEmail({
      preheader: "Your Urban Phoenix account is ready.",
      eyebrow: "Welcome",
      heading: "Welcome to Urban Phoenix",
      bodyHtml: `${para(`Hi ${escapeHtml(name)},`)}${para("Your account is ready. You can now track your orders, save addresses and your wishlist, and be first to know about new drops and limited editions.")}`,
      cta: { url: shopUrl, label: "Shop The Collection" },
    }),
  }, "welcome");
}

// New-order alert for the store owner — sent right after an order commits,
// to ORDERS_EMAIL (falls back to ADMIN_EMAIL / SMTP_USER).
export async function sendAdminNewOrderEmail({ order, toOverride }) {
  if (!isConfigured) return { sent: false, reason: "unconfigured" };
  // toOverride is only used by the admin email test tool.
  const to = toOverride || ORDERS_EMAIL || ADMIN_EMAIL || SMTP_USER;
  if (!to) return { sent: false, reason: "no-recipient" };
  const adminUrl = `${getPublicUrl()}/admin`;
  const c = order.customer || {};
  const itemsText = order.items.map((i) => {
    const serials = i.isLimitedEdition && i.editionNumbers?.length ? ` — piece ${i.editionNumbers.map((n) => String(n).padStart(3, "0")).join(", ")}` : "";
    return `${i.quantity}× ${i.name} (${i.color} / ${i.size})${serials} — ${fmtMoney(i.lineTotal)}`;
  });
  const payment = `${PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod} · ${paymentStatusLabel(order)}`;
  return deliver({
    from: formatSender("orders"),
    to,
    replyTo: c.email || undefined,
    subject: `New order #${order.orderNumber} — ${fmtMoney(order.total)} — ${c.firstName || ""} ${c.lastName || ""}`.trim(),
    text: [
      `New order #${order.orderNumber} (${fmtDate(order.createdAt)})`,
      ``,
      ...itemsText,
      ``,
      `Total: ${fmtMoney(order.total)} (shipping ${Number(order.shipping) === 0 ? "free" : fmtMoney(order.shipping)})`,
      `Payment: ${payment}`,
      `Delivery: ${deliveryMethodLabel(order)}`,
      ``,
      `Customer: ${c.firstName} ${c.lastName} <${c.email}> ${c.phone || ""}`,
      `Ship to: ${c.address}${c.apartment ? `, ${c.apartment}` : ""}, ${c.city}${c.postalCode ? ` ${c.postalCode}` : ""}, ${getCountryName(c.country)}`,
      c.deliveryNotes ? `Notes: ${c.deliveryNotes}` : "",
      ``,
      `Manage: ${adminUrl}`,
    ].join("\n"),
    html: brandedEmail({
      preheader: `${fmtMoney(order.total)} from ${c.firstName || ""} ${c.lastName || ""}`,
      eyebrow: "Admin · New Order",
      heading: `Order #${order.orderNumber}`,
      bodyHtml: `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT};">${orderItemsHtml(order)}</table>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-family:${FONT};margin-bottom:18px;">
          ${summaryRow("Delivery", Number(order.shipping) === 0 ? "Free" : fmtMoney(order.shipping))}
          ${summaryRow("Total", fmtMoney(order.total), { strong: true })}
        </table>
        ${para(`<strong style="color:#f5f5f3;">Customer</strong><br />${escapeHtml(`${c.firstName || ""} ${c.lastName || ""}`)}<br /><a href="mailto:${escapeHtml(c.email || "")}" style="color:#c65d1e;text-decoration:none;">${escapeHtml(c.email || "")}</a>${c.phone ? `<br />${escapeHtml(c.phone)}` : ""}`)}
        ${para(`<strong style="color:#f5f5f3;">Ship to</strong><br />${escapeHtml(c.address || "")}${c.apartment ? `, ${escapeHtml(c.apartment)}` : ""}<br />${escapeHtml(c.city || "")}${c.postalCode ? `, ${escapeHtml(c.postalCode)}` : ""}<br />${escapeHtml(getCountryName(c.country))}<br /><span style="color:#8a8a8a;">${escapeHtml(deliveryMethodLabel(order))}</span>${c.deliveryNotes ? `<br /><span style="color:#8a8a8a;">Notes: ${escapeHtml(c.deliveryNotes)}</span>` : ""}`)}
        ${para(`<strong style="color:#f5f5f3;">Payment</strong><br />${escapeHtml(payment)}`)}`,
      cta: { url: adminUrl, label: "Open Admin" },
    }),
  }, `admin new-order (#${order.orderNumber})`);
}

// Receipt for whoever bought a gift card — the card itself goes to the
// recipient via sendGiftCardEmail(); this confirms the purchase to the buyer.
export async function sendGiftCardPurchaseReceipt({ to, amount, currency = "USD", recipientEmail, recipientName }) {
  if (!isConfigured) return { sent: false, reason: "unconfigured" };
  const amountLabel = fmtGiftCardAmount(amount, currency);
  const who = recipientName ? `${recipientName} (${recipientEmail})` : recipientEmail;
  return deliver({
    from: formatSender("orders"),
    to,
    replyTo: EMAIL_SENDERS.support.email,
    subject: `Your Urban Phoenix gift card purchase — ${amountLabel}`,
    text: `Thank you for your purchase.\n\nYour ${amountLabel} Urban Phoenix gift card has been sent to ${who}.\n\nIf they don't see it, ask them to check their spam folder, or reply to this email and we'll resend it.\n\n— Urban Phoenix`,
    html: brandedEmail({
      preheader: `Your ${amountLabel} gift card has been delivered.`,
      eyebrow: "Gift Card Purchase",
      heading: "Gift card sent",
      bodyHtml: `${para("Thank you for your purchase.")}${para(`Your <strong style="color:#f5f5f3;">${escapeHtml(amountLabel)}</strong> Urban Phoenix gift card has been emailed to <strong style="color:#f5f5f3;">${escapeHtml(who)}</strong>.`)}${para("If they don't see it, ask them to check their spam folder — or reply to this email and we'll resend it.")}`,
    }),
  }, "gift card receipt");
}
