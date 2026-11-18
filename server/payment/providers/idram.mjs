// Idram wallet — the ONLY file that knows the Idram Merchant API protocol
// (field names, checksum formula, payment URL). Orchestration (pending
// checkouts, orders) lives in server/payment/idramService.mjs.
//
// Flow (see "Idram Merchant Online API" PDF):
//   1. Our checkout page POSTs a hidden form (EDP_* fields) to
//      IDRAM_PAYMENT_URL — the customer pays on Idram's own page.
//   2. Idram calls RESULT_URL (/payment/idram-result) twice:
//        a) precheck  — EDP_PRECHECK=YES; we answer "OK" only if the bill is
//           real and still payable, otherwise Idram refuses the payment.
//        b) confirmation — signed with EDP_CHECKSUM (MD5, see verifyChecksum);
//           only this call ever turns a pending checkout into a paid order.
//   3. Idram redirects the customer to SUCCESS_URL or FAIL_URL.
//
// Environment:
//   IDRAM_REC_ACCOUNT  — merchant IdramID (EDP_REC_ACCOUNT)
//   IDRAM_SECRET_KEY   — shared secret used only for the checksum; never sent
//                        to the browser
//   IDRAM_EMAIL        — optional EDP_EMAIL override (Idram emails this address
//                        if our RESULT_URL doesn't answer "OK" to a confirmation)
//
// Every payment charges the real order total, converted to AMD.
import { createHash, timingSafeEqual } from 'node:crypto';
import { RATES } from '../../../src/data/currency.js';

export const IDRAM_PAYMENT_URL = 'https://banking.idram.am/Payment/GetPayment';

function env(name) {
  return String(process.env[name] || '').trim();
}

export function getRecAccount() {
  return env('IDRAM_REC_ACCOUNT');
}

export function isConfigured() {
  return Boolean(getRecAccount() && env('IDRAM_SECRET_KEY'));
}

export function describeConfig() {
  if (!isConfigured()) {
    return { status: 'unconfigured', message: 'Idram is not configured (IDRAM_REC_ACCOUNT / IDRAM_SECRET_KEY) — the Idram option is hidden at checkout.' };
  }
  return { status: 'configured', message: 'Idram is configured — payments charge the real order total in AMD.' };
}

// Orders are USD internally (see src/data/currency.js); Idram charges AMD.
// Same conversion the checkout page shows in its "Payments are processed in
// Armenian dram" note, so the customer sees exactly what Idram will ask for.
export function chargeAmountAmd(totalUsd) {
  return Math.round(Number(totalUsd) * RATES.AMD);
}

// "Fraction must be separated by period (dot)". Whole amounts are sent
// without a fraction, matching Idram's own example ("1900").
export function formatAmount(amount) {
  const value = Number(amount);
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function amountsEqual(received, expected) {
  const value = Number(String(received ?? '').trim());
  return Number.isFinite(value) && Math.abs(value - Number(expected)) < 0.005;
}

const LANGUAGES = { en: 'EN', hy: 'AM', am: 'AM', ru: 'RU' };
export function toIdramLanguage(siteLanguage) {
  return LANGUAGES[String(siteLanguage || '').toLowerCase()] || 'EN';
}

// The hidden fields the browser posts to IDRAM_PAYMENT_URL.
export function buildPaymentFields({ billNo, amount, description, language }) {
  const fields = {
    EDP_LANGUAGE: toIdramLanguage(language),
    EDP_REC_ACCOUNT: getRecAccount(),
    EDP_DESCRIPTION: String(description || '').slice(0, 250),
    EDP_AMOUNT: formatAmount(amount),
    EDP_BILL_NO: String(billNo),
  };
  const email = env('IDRAM_EMAIL');
  if (email) fields.EDP_EMAIL = email;
  return fields;
}

// MD5 of EDP_REC_ACCOUNT:EDP_AMOUNT:SECRET_KEY:EDP_BILL_NO:EDP_PAYER_ACCOUNT:EDP_TRANS_ID:EDP_TRANS_DATE,
// computed over the exact strings Idram sent (not re-formatted numbers).
export function computeChecksum(params, secretKey = env('IDRAM_SECRET_KEY')) {
  const text = [
    params.EDP_REC_ACCOUNT,
    params.EDP_AMOUNT,
    secretKey,
    params.EDP_BILL_NO,
    params.EDP_PAYER_ACCOUNT,
    params.EDP_TRANS_ID,
    params.EDP_TRANS_DATE,
  ].map((value) => String(value ?? '')).join(':');
  return createHash('md5').update(text, 'utf8').digest('hex');
}

// Case-insensitive (Idram's own reference implementation upper-cases both
// sides) and constant-time, so the comparison can't leak the expected value.
export function verifyChecksum(params) {
  const secretKey = env('IDRAM_SECRET_KEY');
  const received = String(params.EDP_CHECKSUM || '').trim().toLowerCase();
  if (!secretKey || !/^[0-9a-f]{32}$/.test(received)) return false;
  const expected = computeChecksum(params, secretKey);
  return timingSafeEqual(Buffer.from(received), Buffer.from(expected));
}
