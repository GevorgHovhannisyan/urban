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
  ZEPTOMAIL_TOKEN,
  ZEPTOMAIL_API_URL,
  MAIL_FROM,
} = process.env;
console.log(
  `SMTP config: host=${SMTP_HOST}, port=${SMTP_PORT}, user=${SMTP_USER}, pass=${SMTP_PASS ? "***" : "(not set)"}, secure=${SMTP_SECURE}, from=${SMTP_FROM}, support=${SUPPORT_EMAIL}, orders=${ORDERS_EMAIL}, admin=${ADMIN_EMAIL}, zeptomail=${ZEPTOMAIL_TOKEN ? "on" : "off"}`,
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

// Two ways to send, same templates either way:
//   - ZeptoMail (Zoho's transactional email API) over HTTPS when
//     ZEPTOMAIL_TOKEN is set. This is the production path: DigitalOcean
//     blocks outgoing SMTP ports (465/587), but HTTPS on 443 is never blocked.
//   - Zoho Mail SMTP otherwise (e.g. local development).
const useZeptoMail = Boolean(ZEPTOMAIL_TOKEN);
const smtpConfigured = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS);
const isConfigured = useZeptoMail || smtpConfigured;
// .eu matches this store's Zoho EU account (smtp.zoho.eu); override for
// another Zoho data center (e.g. https://api.zeptomail.com/v1.1/email).
const ZEPTO_URL = ZEPTOMAIL_API_URL || "https://api.zeptomail.eu/v1.1/email";
// Accepts the token exactly as ZeptoMail shows it ("Zoho-enczapikey ...") or
// just the key part.
const ZEPTO_AUTH = useZeptoMail
  ? (/^Zoho-enczapikey\s/i.test(ZEPTOMAIL_TOKEN.trim()) ? ZEPTOMAIL_TOKEN.trim() : `Zoho-enczapikey ${ZEPTOMAIL_TOKEN.trim()}`)
  : null;

// Distinguishes "not set up at all" from "partially set up" (e.g. host/user
// present but the password wasn't actually pasted into .env yet) — the
// latter is worth a clearer startup warning than a silent fall-through to
// dev-preview mode, since it usually means a deploy is one step away from
// working mail and nobody would otherwise notice until a customer complains
// an email never arrived. Never includes any credential value — only
// presence/absence — so this is safe to log or return from an API.
export function describeSmtpConfig() {
  if (useZeptoMail) {
    return { status: "configured", message: `Sending via ZeptoMail API over HTTPS (${new URL(ZEPTO_URL).host}).` };
  }
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

// Short timeouts so a blocked/unreachable mail server fails in seconds (with
// a clear error) instead of hanging a request for minutes.
const SMTP_TIMEOUTS = { connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000 };

function createSmtpTransport({ port, secure }) {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port,
    secure,
    // STARTTLS on 587 must actually upgrade — never send credentials in clear.
    requireTLS: !secure,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    ...SMTP_TIMEOUTS,
  });
}

const primarySmtp = smtpConfigured && !useZeptoMail
  ? {
      port: Number(SMTP_PORT),
      // Explicit SMTP_SECURE wins when set (Zoho: 465/true). Falls back to the
      // port-465-implies-TLS heuristic, so a deployment that only ever set
      // SMTP_PORT keeps working unchanged.
      secure: SMTP_SECURE !== undefined ? SMTP_SECURE === "true" : Number(SMTP_PORT) === 465,
    }
  : null;
// Many VPS/cloud hosts block one of the two submission ports. Zoho (and most
// providers) accept both 465 (TLS) and 587 (STARTTLS), so if the configured
// one can't even connect, the other is tried automatically.
const alternateSmtp = primarySmtp
  ? primarySmtp.port === 465
    ? { port: 587, secure: false }
    : primarySmtp.port === 587
      ? { port: 465, secure: true }
      : null
  : null;

let transporter = primarySmtp ? createSmtpTransport(primarySmtp) : null;
let activeSmtp = primarySmtp;
const CONNECTION_FAILED = /(ETIMEDOUT|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ESOCKET|ECONNECTION|Greeting never received|Connection timeout|connect)/i;

// Switches to the alternate port once if the current one can't connect.
// Returns true if a switch happened (caller should retry).
function switchToAlternateSmtp(error) {
  if (!alternateSmtp || activeSmtp === alternateSmtp) return false;
  if (!CONNECTION_FAILED.test(`${error?.code || ""} ${error?.message || ""}`)) return false;
  console.warn(`[mail] Cannot reach ${SMTP_HOST}:${activeSmtp.port} (${error.code || error.message}) — switching to port ${alternateSmtp.port}.`);
  transporter = createSmtpTransport(alternateSmtp);
  activeSmtp = alternateSmtp;
  return true;
}

export function getActiveSmtpPort() {
  return activeSmtp?.port || null;
}

// Backend-only, never exposed over HTTP — confirms the transporter can
// actually authenticate with the SMTP provider (distinct from "the env vars
// are present," which describeSmtpConfig() above already checks). Intended
// for a one-off manual check (see scripts/verify-smtp.mjs) or a startup log,
// never a request handler; the App Password never leaves this process.
export async function verifySmtpConnection() {
  if (useZeptoMail) return verifyZeptoMail();
  if (!transporter) return { ok: false, reason: "unconfigured" };
  try {
    await transporter.verify();
    return { ok: true, port: activeSmtp.port };
  } catch (error) {
    if (switchToAlternateSmtp(error)) {
      try {
        await transporter.verify();
        return { ok: true, port: activeSmtp.port, note: `Port ${primarySmtp.port} is blocked on this server; using ${activeSmtp.port} instead.` };
      } catch (retryError) {
        return { ok: false, reason: "connection-failed", message: `Port ${primarySmtp.port}: ${error.code || error.message}. Port ${alternateSmtp.port}: ${retryError.code || retryError.message}.` };
      }
    }
    return { ok: false, reason: "connection-failed", message: `${error.code ? `${error.code}: ` : ""}${error.message}` };
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
const legacyFallbackEmail = extractEmail(SMTP_FROM) || MAIL_FROM || SMTP_USER;

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

// "Name <addr>" / "addr" → { name, address }
function parseAddress(value) {
  const str = String(value || "").trim();
  const match = str.match(/^(.*)<([^>]+)>\s*$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ""), address: match[2].trim() };
  return { name: "", address: str };
}

function zeptoErrorMessage(status, payload) {
  const err = payload?.error;
  if (!err) return `ZeptoMail HTTP ${status}`;
  const details = (err.details || []).map((d) => [d.target, d.message].filter(Boolean).join(": ")).filter(Boolean);
  return `ZeptoMail ${err.code || status}: ${err.message || "request failed"}${details.length ? ` (${details.join("; ")})` : ""}`;
}

async function sendViaZeptoMail(mail, label) {
  const from = parseAddress(mail.from);
  const to = parseAddress(mail.to);
  const body = {
    from: { address: from.address, ...(from.name ? { name: from.name } : {}) },
    to: [{ email_address: { address: to.address, ...(to.name ? { name: to.name } : {}) } }],
    subject: mail.subject,
    htmlbody: mail.html || mail.text,
    ...(mail.text ? { textbody: mail.text } : {}),
    ...(mail.replyTo ? { reply_to: [{ address: parseAddress(mail.replyTo).address }] } : {}),
  };
  try {
    const response = await fetch(ZEPTO_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: ZEPTO_AUTH },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(zeptoErrorMessage(response.status, payload));
    console.log(`[mail] ${label} → ${to.address} accepted by ZeptoMail (request_id=${payload?.request_id})`);
    return { sent: true, messageId: payload?.request_id || null, response: payload?.message || "ZeptoMail accepted", from: mail.from, provider: "zeptomail" };
  } catch (error) {
    const message = error.name === "TimeoutError" ? "ZeptoMail API timed out" : error.message;
    console.error(`[mail] ${label} → ${to.address} FAILED (ZeptoMail): ${message}`);
    return { sent: false, reason: "send-failed", error: message };
  }
}

// Confirms the API is reachable and the token is accepted, without sending:
// an empty request is rejected for missing fields when the token is valid,
// but with 401/403 when it isn't.
async function verifyZeptoMail() {
  try {
    const response = await fetch(ZEPTO_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: ZEPTO_AUTH },
      body: "{}",
      signal: AbortSignal.timeout(15000),
    });
    const payload = await response.json().catch(() => null);
    if (response.status === 401 || response.status === 403) {
      return { ok: false, reason: "auth-failed", message: zeptoErrorMessage(response.status, payload) };
    }
    return { ok: true, port: "HTTPS API", note: "ZeptoMail token accepted" };
  } catch (error) {
    return { ok: false, reason: "connection-failed", message: error.name === "TimeoutError" ? "ZeptoMail API timed out" : error.message };
  }
}

async function deliver(mail, label) {
  if (useZeptoMail) return sendViaZeptoMail(mail, label);
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
  } catch (firstError) {
    let error = firstError;
    if (switchToAlternateSmtp(error)) {
      try {
        return await attempt(mail);
      } catch (portError) {
        error = portError;
      }
    }
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

// Montserrat everywhere (loaded from Google Fonts in the <head>). Clients
// that block web fonts (Gmail apps, Outlook) fall back to Helvetica/Arial —
// never to a serif — so the design holds up everywhere.
const FONT = "'Montserrat','Helvetica Neue',Helvetica,Arial,sans-serif";
const C = {
  ink: "#0a0a0a",        // headings / strong text
  text: "#3a3a3a",       // body copy
  muted: "#7a7a7a",      // secondary text
  faint: "#a3a3a3",
  line: "#e6e4df",       // hairlines
  panel: "#f6f5f2",      // soft boxes
  page: "#eeece8",       // outside the card
  accent: "#c65d1e",     // brand orange
};

// Bulletproof button (table-based, so it renders as a real button in Outlook).
function emailButton(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" class="up-btn-wrap" style="margin:0 auto;"><tr><td align="center" class="up-btn" style="background:${C.accent};"><a href="${escapeHtml(url)}" style="display:block;padding:16px 38px;font-family:${FONT};font-size:12px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a></td></tr></table>`;
}

// A labelled info box (order number, date…): rows of [label, value(html)].
function infoBox(rows) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.panel};border:1px solid ${C.line};margin:6px 0 4px;">${rows.map(([label, value], i) => `
    <tr>
      <td style="padding:${i ? "0" : "16px"} 18px ${i === rows.length - 1 ? "16px" : "10px"};font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${C.muted};">${escapeHtml(label)}</td>
      <td align="right" style="padding:${i ? "0" : "16px"} 18px ${i === rows.length - 1 ? "16px" : "10px"};font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink};">${value}</td>
    </tr>`).join("")}</table>`;
}

// Shared, branded, mobile-friendly shell for every email: black header with
// the logo, orange accent rule, white content card, footer with links.
// Table-only layout with inline CSS so it survives Gmail/Outlook/Apple Mail.
// `bodyHtml` must already be escaped by the caller.
function brandedEmail({ preheader = "", eyebrow = "", heading = "", bodyHtml = "", cta = null, note = "", signoff = true }) {
  const site = getPublicUrl();
  const logoUrl = `${site}/images/brand/up-logo-email-white.png`;
  const support = EMAIL_SENDERS.support.email || "";
  const link = (href, label) => `<a href="${escapeHtml(href)}" style="font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:${C.ink};text-decoration:none;white-space:nowrap;">${label}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="x-apple-disable-message-reformatting" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escapeHtml(heading || "Urban Phoenix")}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
<style>
  @import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap');
  body, table, td, p, a, span { font-family: ${FONT}; }
  a { text-decoration: none; }
  @media only screen and (max-width: 600px) {
    .up-container { width: 100% !important; }
    .up-px { padding-left: 24px !important; padding-right: 24px !important; }
    .up-hero { font-size: 24px !important; line-height: 1.25 !important; }
    .up-btn-wrap, .up-btn { width: 100% !important; }
    .up-stack { display: block !important; width: 100% !important; padding: 0 0 18px 0 !important; }
    .up-hide-mobile { display: none !important; }
    .up-card-pad { padding: 22px 18px 20px !important; }
    .up-card-brand { font-size: 11px !important; letter-spacing: 0.2em !important; }
    .up-card-code { font-size: 18px !important; letter-spacing: 0.06em !important; }
  }
</style>
<!--[if mso]><style>body, table, td, p, a, span { font-family: Arial, Helvetica, sans-serif !important; }</style><![endif]-->
</head>
<body style="margin:0;padding:0;background:${C.page};-webkit-font-smoothing:antialiased;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(preheader)}&#8203;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.page};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" class="up-container" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;">
          <!-- Header -->
          <tr>
            <td align="center" style="background:${C.ink};padding:28px 32px 26px;">
              <a href="${escapeHtml(site)}" style="text-decoration:none;">
                <img src="${logoUrl}" alt="Urban Phoenix" width="48" height="44" style="display:block;margin:0 auto 12px;width:48px;height:44px;border:0;outline:none;" />
                <span style="font-family:${FONT};font-size:13px;font-weight:700;letter-spacing:0.42em;color:#ffffff;">URBAN&nbsp;PHOENIX</span>
              </a>
            </td>
          </tr>
          <tr><td style="background:${C.accent};height:3px;font-size:0;line-height:0;">&nbsp;</td></tr>
          <!-- Content -->
          <tr>
            <td class="up-px" style="padding:44px 52px 8px;">
              ${eyebrow ? `<p style="margin:0 0 12px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:${C.accent};">${escapeHtml(eyebrow)}</p>` : ""}
              ${heading ? `<h1 class="up-hero" style="margin:0 0 22px;font-family:${FONT};font-size:28px;line-height:1.2;font-weight:800;letter-spacing:-0.01em;color:${C.ink};">${escapeHtml(heading)}</h1>` : ""}
              <div style="font-family:${FONT};font-size:15px;line-height:1.65;color:${C.text};">${bodyHtml}</div>
            </td>
          </tr>
          ${cta ? `<tr><td class="up-px" align="center" style="padding:20px 52px 8px;">${emailButton(cta.url, cta.label)}</td></tr>` : ""}
          ${note ? `<tr><td class="up-px" style="padding:22px 52px 0;font-family:${FONT};font-size:13px;line-height:1.6;color:${C.muted};">${note}</td></tr>` : ""}
          <!-- Sign-off (customer emails only) -->
          ${signoff ? `
          <tr>
            <td class="up-px" style="padding:30px 52px 40px;">
              <p style="margin:0;padding-top:24px;border-top:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text};">Questions? Simply reply to this email or write to <a href="mailto:${escapeHtml(support)}" style="color:${C.accent};font-weight:600;text-decoration:none;">${escapeHtml(support)}</a>.</p>
              <p style="margin:14px 0 0;font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink};">— The Urban Phoenix team</p>
            </td>
          </tr>` : `<tr><td style="height:40px;font-size:0;line-height:0;">&nbsp;</td></tr>`}
          <!-- Footer -->
          <tr>
            <td align="center" style="background:${C.panel};padding:26px 32px 30px;border-top:1px solid ${C.line};">
              <p style="margin:0 0 14px;">${link(`${site}/shop`, "Shop")}<span style="color:${C.faint};">&nbsp;&nbsp;·&nbsp; </span>${link(`${site}/track`, "Track order")}<span style="color:${C.faint};">&nbsp;&nbsp;·&nbsp; </span>${link(`${site}/contact`, "Contact")}</p>
              <p style="margin:0 0 6px;font-family:${FONT};font-size:12px;color:${C.muted};">Urban Phoenix · Yerevan, Armenia</p>
              <p style="margin:0;font-family:${FONT};font-size:11px;color:${C.faint};">© ${new Date().getFullYear()} Urban Phoenix. Built from chaos. Built for the few.</p>
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
export async function sendVerificationCode({ to, name, code, expiresInMinutes = 10 }) {
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
    text: `Hi ${name},\n\nWelcome to Urban Phoenix. Your verification code is: ${code}\n\nEnter this code on the site to activate your account. It expires in ${expiresInMinutes} minutes.\n\nIf you didn't create an account, you can ignore this email.\n\n— Urban Phoenix`,
    html: brandedEmail({
      preheader: `Your verification code is ${code}`,
      eyebrow: "Account Registration",
      heading: "Confirm your email",
      bodyHtml: `${para(`Hi ${escapeHtml(name)},`)}${para("Welcome to Urban Phoenix. Enter this code on the site to activate your account:")}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 18px;"><tr><td align="center" style="background:${C.panel};border:1px solid ${C.line};border-top:3px solid ${C.accent};padding:24px 10px;font-family:${FONT};font-size:36px;font-weight:800;letter-spacing:0.32em;color:${C.ink};">${escapeHtml(code)}</td></tr></table>`,
      note: `This code expires in ${expiresInMinutes} minutes. If you didn't create an account, you can safely ignore this email.`,
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
      note: `This link expires in 60 minutes. If you didn't request a reset, you can ignore this email — your password won't change.<br /><br />Button not working? Copy this link into your browser:<br /><a href="${escapeHtml(link)}" style="color:${C.accent};text-decoration:underline;word-break:break-all;">${escapeHtml(link)}</a>`,
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
      currencyDisplay: "narrowSymbol",
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
// The card itself stays dark — it reads as a physical card on the white email.
function giftCardVisualHtml({ amountLabel, currency, code }) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.ink};border-top:3px solid ${C.accent};">
      <tr>
        <td class="up-card-pad" style="padding:26px 26px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td class="up-card-brand" style="font-family:${FONT};font-weight:700;font-size:12px;letter-spacing:0.36em;color:#ffffff;">URBAN&nbsp;PHOENIX</td>
              <td align="right" style="font-family:${FONT};font-weight:700;font-size:10px;letter-spacing:0.24em;color:${C.accent};white-space:nowrap;">GIFT&nbsp;CARD</td>
            </tr>
          </table>
          <p style="margin:30px 0 2px;font-family:${FONT};font-weight:800;font-size:40px;line-height:1.1;color:#ffffff;">${escapeHtml(amountLabel)}</p>
          <p style="margin:0;font-family:${FONT};font-size:11px;font-weight:600;letter-spacing:0.2em;color:#8a8a8a;">${escapeHtml(currency || "USD")} · COLLECTION 001</p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;border-top:1px solid #2a2a2a;">
            <tr><td style="padding-top:18px;font-family:${FONT};font-size:10px;font-weight:600;letter-spacing:0.22em;color:#8a8a8a;">GIFT CARD CODE</td></tr>
            <tr><td class="up-card-code" style="padding-top:8px;font-family:${FONT};font-weight:700;font-size:22px;letter-spacing:0.14em;color:#ffffff;word-break:break-all;">${escapeHtml(code)}</td></tr>
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

  const html = brandedEmail({
    preheader: `${senderName ? `${senderName} sent you a gift card` : "You've received a gift card"}, worth ${amountLabel}.`,
    eyebrow: "Gift card",
    heading: senderName ? `${senderName} sent you a gift card` : "You've received a gift card",
    bodyHtml: `
      ${para(greetingHtml)}
      ${para(`Here's an Urban Phoenix gift card worth <strong style="color:${C.ink};">${escapeHtml(amountLabel)}</strong>.`)}
      ${message ? `<p style="margin:4px 0 20px;background:${C.panel};border-left:3px solid ${C.accent};padding:14px 16px;font-style:italic;color:${C.ink};">“${escapeHtml(message)}”</p>` : ""}
      ${giftCardVisualHtml({ amountLabel, currency, code })}
      <p style="margin:20px 0 0;">Add the code in your bag, under <strong style="color:${C.ink};">Gift Card</strong>, before checkout. If your order costs less than the card's value, the rest stays on the card for next time.</p>`,
    cta: { url: shopUrl, label: "Shop Urban Phoenix" },
  });

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
    // Retired methods (studio pickup, express) keep their own label on old orders.
    const RETIRED = { pickup: ['Pickup', 'Free — collect from our Yerevan studio'], express: ['Express Delivery', 'Same-day / next-day'] };
    if (RETIRED[order.deliveryMethod]) {
      const [label, estimate] = RETIRED[order.deliveryMethod];
      return `${label} — ${order.deliveryEstimate || estimate}`;
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
function editionOwnershipLine(item, { forAdmin = false } = {}) {
  if (!item.isLimitedEdition || !item.editionNumbers?.length) return "";
  const total = item.editionTotal || 100;
  const serials = item.editionNumbers.map(
    (number) =>
      `${String(number).padStart(3, "0")}/${String(total).padStart(3, "0")}`,
  );
  const text = forAdmin
    ? `Limited edition · ${serials.length > 1 ? "Pieces" : "Piece"} ${serials.join(", ")}`
    : serials.length > 1
      ? `Pieces ${serials.join(", ")} are yours.`
      : `Piece ${serials[0]} is yours.`;
  return `<p style="margin:8px 0 0;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.accent};">${escapeHtml(text)}</p>`;
}

function orderItemsHtml(order, { forAdmin = false } = {}) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line};">${order.items
    .map((item) => {
      const imageCell = item.image
        ? `<img src="${escapeHtml(item.image)}" width="72" height="90" alt="${escapeHtml(item.name)}" style="display:block;width:72px;height:90px;object-fit:cover;background:${C.panel};border:0;" />`
        : `<table role="presentation" width="72" height="90" cellpadding="0" cellspacing="0" style="width:72px;height:90px;background:${C.panel};"><tr><td align="center" valign="middle" style="font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.15em;color:${C.faint};">UP</td></tr></table>`;
      return `
      <tr>
        <td width="72" valign="top" style="padding:18px 0;border-bottom:1px solid ${C.line};">${imageCell}</td>
        <td valign="top" style="padding:18px 12px 18px 16px;border-bottom:1px solid ${C.line};">
          <p style="margin:0 0 6px;font-family:${FONT};font-size:14px;font-weight:700;line-height:1.35;color:${C.ink};">${escapeHtml(item.name)}</p>
          <p style="margin:0;font-family:${FONT};font-size:12px;line-height:1.5;color:${C.muted};">${escapeHtml(item.color)} · Size ${escapeHtml(item.size)} · Qty ${Number(item.quantity)}</p>
          ${editionOwnershipLine(item, { forAdmin })}
        </td>
        <td valign="top" align="right" style="padding:18px 0;border-bottom:1px solid ${C.line};white-space:nowrap;font-family:${FONT};font-size:14px;font-weight:600;color:${C.ink};">${fmtMoney(item.lineTotal)}</td>
      </tr>`;
    })
    .join("")}</table>`;
}

function summaryRow(label, value, { accent = false, strong = false } = {}) {
  const color = accent ? C.accent : strong ? C.ink : C.text;
  return `
    <tr>
      <td style="padding:${strong ? "14px 0 0" : "5px 0"};font-family:${FONT};font-size:${strong ? "15px" : "14px"};font-weight:${strong ? 700 : 500};color:${color};${strong ? `border-top:1px solid ${C.line};` : ""}">${escapeHtml(label)}</td>
      <td align="right" style="padding:${strong ? "14px 0 0" : "5px 0"};font-family:${FONT};font-size:${strong ? "20px" : "14px"};font-weight:${strong ? 800 : 600};color:${color};${strong ? `border-top:1px solid ${C.line};` : ""}">${value}</td>
    </tr>`;
}

function totalsTable(rowsHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:14px;">${rowsHtml}</table>`;
}

function sectionTitle(text) {
  return `<p style="margin:30px 0 12px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${C.ink};">${escapeHtml(text)}</p>`;
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

  const html = brandedEmail({
    preheader: `Your Urban Phoenix order ${order.orderNumber} is confirmed — thank you for your purchase.`,
    eyebrow: "Order confirmed",
    heading: `Thank you, ${order.customer.firstName || "for your order"}.`,
    bodyHtml: `
      ${para("Your order is confirmed and we're preparing it now. We'll email you again as soon as it ships.")}
      ${infoBox([["Order number", escapeHtml(order.orderNumber)], ["Order date", escapeHtml(fmtDate(order.createdAt))]])}
      ${sectionTitle("Your items")}
      ${orderItemsHtml(order)}
      ${totalsTable(`
        ${summaryRow("Subtotal", fmtMoney(order.subtotal))}
        ${discountRows}
        ${summaryRow("Delivery", Number(order.shipping) === 0 ? "Free" : fmtMoney(order.shipping))}
        <tr><td colspan="2" style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>
        ${summaryRow("Total", fmtMoney(order.total), { strong: true })}
      `)}
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:30px;">
        <tr>
          <td class="up-stack" width="50%" valign="top" style="padding-right:14px;">
            <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${C.ink};">Delivery address</p>
            <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text};">
              ${escapeHtml(order.customer.firstName)} ${escapeHtml(order.customer.lastName)}<br />
              ${escapeHtml(order.customer.address)}${order.customer.apartment ? `, ${escapeHtml(order.customer.apartment)}` : ""}<br />
              ${escapeHtml(order.customer.city)}${order.customer.postalCode ? `, ${escapeHtml(order.customer.postalCode)}` : ""}<br />
              ${escapeHtml(getCountryName(order.customer.country))}
            </p>
            <p style="margin:10px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">${escapeHtml(delivery)}</p>
            ${order.customer.deliveryNotes ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">Notes: ${escapeHtml(order.customer.deliveryNotes)}</p>` : ""}
          </td>
          <td class="up-stack" width="50%" valign="top" style="padding-left:14px;">
            <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${C.ink};">Payment</p>
            <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text};">${escapeHtml(paymentLabel)}</p>
            <p style="margin:4px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">${escapeHtml(paymentStatusText)}</p>
          </td>
        </tr>
      </table>`,
    cta: trackUrl ? { url: trackUrl, label: "Track your order" } : null,
  });

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
      bodyHtml: `${para(`<strong style="color:${C.ink};">Name:</strong> ${escapeHtml(name)}<br /><strong style="color:${C.ink};">Email:</strong> ${escapeHtml(email)}<br /><strong style="color:${C.ink};">Topic:</strong> ${escapeHtml(topic)}`)}
        <p style="margin:0;white-space:pre-wrap;background:${C.panel};border-left:3px solid ${C.accent};padding:14px 16px;color:${C.ink};">${escapeHtml(message)}</p>`,
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
      bodyHtml: `${para(`Hi ${escapeHtml(name)},`)}${para(`Thanks for reaching out about <strong style="color:${C.ink};">${escapeHtml(topic)}</strong>. Our support team has received your message and will get back to you shortly.`)}`,
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
      body: `Great news — order #${num} has been dispatched and is on its way to you.`,
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
      bodyHtml: `${para(`Hi ${escapeHtml(firstName)},`)}${para(escapeHtml(copy.body))}${infoBox([["Order number", escapeHtml(num)]])}`,
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
      eyebrow: "New order",
      heading: `${fmtMoney(order.total)} from ${`${c.firstName || ""} ${c.lastName || ""}`.trim() || "a customer"}`,
      bodyHtml: `
        ${infoBox([["Order number", escapeHtml(order.orderNumber)], ["Placed", escapeHtml(fmtDate(order.createdAt))], ["Payment", escapeHtml(payment)]])}
        ${sectionTitle("Items")}
        ${orderItemsHtml(order, { forAdmin: true })}
        ${totalsTable(`
          ${summaryRow("Subtotal", fmtMoney(order.subtotal))}
          ${summaryRow("Delivery", Number(order.shipping) === 0 ? "Free" : fmtMoney(order.shipping))}
          <tr><td colspan="2" style="height:8px;font-size:0;line-height:0;">&nbsp;</td></tr>
          ${summaryRow("Total", fmtMoney(order.total), { strong: true })}
        `)}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:30px;">
          <tr>
            <td class="up-stack" width="50%" valign="top" style="padding-right:14px;">
              <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${C.ink};">Customer</p>
              <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text};">
                ${escapeHtml(`${c.firstName || ""} ${c.lastName || ""}`)}<br />
                <a href="mailto:${escapeHtml(c.email || "")}" style="color:${C.accent};text-decoration:none;">${escapeHtml(c.email || "")}</a>${c.phone ? `<br />${escapeHtml(c.phone)}` : ""}
              </p>
            </td>
            <td class="up-stack" width="50%" valign="top" style="padding-left:14px;">
              <p style="margin:0 0 8px;font-family:${FONT};font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:${C.ink};">Ship to</p>
              <p style="margin:0;font-family:${FONT};font-size:14px;line-height:1.6;color:${C.text};">
                ${escapeHtml(c.address || "")}${c.apartment ? `, ${escapeHtml(c.apartment)}` : ""}<br />
                ${escapeHtml(c.city || "")}${c.postalCode ? `, ${escapeHtml(c.postalCode)}` : ""}<br />
                ${escapeHtml(getCountryName(c.country))}
              </p>
              <p style="margin:10px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">${escapeHtml(deliveryMethodLabel(order))}</p>
              ${c.deliveryNotes ? `<p style="margin:6px 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${C.muted};">Notes: ${escapeHtml(c.deliveryNotes)}</p>` : ""}
            </td>
          </tr>
        </table>`,
      note: "Reply to this email to write to the customer directly.",
      signoff: false,
      cta: { url: adminUrl, label: "Open in admin" },
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
      bodyHtml: `${para("Thank you for your purchase.")}${para(`Your <strong style="color:${C.ink};">${escapeHtml(amountLabel)}</strong> Urban Phoenix gift card has been emailed to <strong style="color:${C.ink};">${escapeHtml(who)}</strong>.`)}${para("If they don't see it, ask them to check their spam folder — or reply to this email and we'll resend it.")}`,
    }),
  }, "gift card receipt");
}
