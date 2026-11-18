// ArCa card payments (Visa / Mastercard / ArCa) — the ONLY file that knows the
// ArCa EPG REST protocol ("EPG – Merchant Integration Guide", SmartVista
// E-Commerce Payment Gateway). Orchestration (pending checkouts, orders)
// lives in server/payment/arcaService.mjs.
//
// Flow (one-phase payment):
//   1. register.do registers the order with the gateway: our orderNumber, the
//      amount in minor units, currency 051 (AMD) and returnUrl. It answers
//      { orderId, formUrl }.
//   2. The browser is sent to formUrl. Card details are typed on ArCa's own
//      page and never reach this server.
//   3. ArCa sends the customer back to returnUrl?orderId=…. That redirect
//      proves nothing by itself: the server asks getOrderStatusExtended.do
//      (authenticated with our own credentials) whether the order was really
//      paid and for how much, and only then creates the order.
//
// Environment:
//   ARCA_API_URL     — REST base URL. Empty = ArCa's TEST gateway
//                      (https://ipaytest.arca.am:8445/payment/rest). Live:
//                      https://ipay.arca.am/payment/rest
//   ARCA_USERNAME    — merchant API user name (from the bank)
//   ARCA_PASSWORD    — merchant API password. Goes in the server's .env only;
//                      never sent to the browser, never logged.
//   ARCA_TEST_AMOUNT — optional. When set (e.g. 10), every card payment
//                      charges exactly this many AMD instead of the real
//                      order total. Prices shown on the site and stored on
//                      the order are NOT changed. Remove it to go live.
import { RATES } from '../../../src/data/currency.js';

export const ARCA_TEST_API_URL = 'https://ipaytest.arca.am:8445/payment/rest';
export const CURRENCY_AMD = '051'; // ISO 4217 numeric

// orderStatus values of getOrderStatusExtended.do ("orderStatus values" table
// of the EPG guide). register.do is a ONE-phase payment, so 1 means paid.
export const ORDER_STATUS = {
  DECLINED_OTHER: -1, // "replaces the decline status" when no other fits
  REGISTERED: 0, // registered, not paid yet (can still be paid)
  APPROVED: 1, // one-phase: approved = paid (two-phase: amount on hold)
  DEPOSITED: 2, // amount deposited
  REVERSED: 3, // final
  REFUNDED: 4,
  DECLINED: 6, // final
};

const REQUEST_TIMEOUT_MS = 20000;

function env(name) {
  return String(process.env[name] || '').trim();
}

export function getApiUrl() {
  return (env('ARCA_API_URL') || ARCA_TEST_API_URL).replace(/\/+$/, '');
}

export function isTestGateway() {
  try {
    return new URL(getApiUrl()).hostname === new URL(ARCA_TEST_API_URL).hostname;
  } catch {
    return false;
  }
}

export function isConfigured() {
  return Boolean(env('ARCA_USERNAME') && env('ARCA_PASSWORD'));
}

// Fixed AMD amount to charge instead of the real total, or null when off.
export function getTestAmount() {
  const value = Number(env('ARCA_TEST_AMOUNT'));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// register.do "features" parameter (EPG guide 4.1): FORCE_TDS = "transaction
// is processed as 3DS2" — the customer gets the card issuer's 3-D Secure page
// (SMS code / bank app) after entering the card on ArCa's page. On by default;
// ARCA_FORCE_3DS=false stops sending it (the merchant's own bank setting then
// decides). The merchant must have the 3DS2 permission at the bank.
export function isForce3dsEnabled() {
  return !/^(0|false|no|off)$/i.test(env('ARCA_FORCE_3DS'));
}

export function describeConfig() {
  if (!isConfigured()) {
    return { status: 'unconfigured', message: 'ArCa card payments are not configured (ARCA_USERNAME / ARCA_PASSWORD).' };
  }
  let host = getApiUrl();
  try { host = new URL(host).host; } catch { /* keep the raw value */ }
  const gateway = `${isTestGateway() ? `TEST gateway ${host}` : `gateway ${host}`}, 3-D Secure ${isForce3dsEnabled() ? 'forced (FORCE_TDS)' : 'per bank setting'}`;
  const testAmount = getTestAmount();
  return {
    status: 'configured',
    message: testAmount
      ? `ArCa card payments are configured (${gateway}) — TEST MODE: every card payment charges ${testAmount} AMD instead of the real total (ARCA_TEST_AMOUNT).`
      : `ArCa card payments are configured (${gateway}) — payments charge the real order total in AMD.`,
  };
}

// Orders are USD internally (see src/data/currency.js); ArCa charges AMD.
// Same conversion the checkout page shows in its "Payments are processed in
// Armenian dram" note.
export function chargeAmountAmd(totalUsd) {
  const testAmount = getTestAmount();
  if (testAmount) return testAmount;
  return Math.round(Number(totalUsd) * RATES.AMD);
}

// "Amount in minimal currency units" — 10 AMD is sent as 1000.
export function toMinorUnits(amountAmd) {
  return Math.round(Number(amountAmd) * 100);
}

const LANGUAGES = { en: 'en', hy: 'hy', am: 'hy', ru: 'ru' };
export function toArcaLanguage(siteLanguage) {
  return LANGUAGES[String(siteLanguage || '').toLowerCase()] || 'en';
}

export class ArcaError extends Error {
  constructor(message, { errorCode = null } = {}) {
    super(message);
    this.name = 'ArcaError';
    this.errorCode = errorCode;
  }
}

// Every EPG method is a POST with application/x-www-form-urlencoded
// parameters and a JSON answer. A non-zero errorCode means the request
// itself failed.
async function callGateway(method, params) {
  const body = new URLSearchParams({
    userName: env('ARCA_USERNAME'),
    password: env('ARCA_PASSWORD'),
    ...params,
  });
  let response;
  try {
    response = await fetch(`${getApiUrl()}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ArcaError(`ArCa ${method} request failed: ${error?.message || error}`);
  }
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ArcaError(`ArCa ${method} answered HTTP ${response.status} with a non-JSON body`);
  }
  const errorCode = data?.errorCode === undefined || data?.errorCode === null || data?.errorCode === '' ? 0 : Number(data.errorCode);
  if (errorCode !== 0) {
    throw new ArcaError(`ArCa ${method} error ${data.errorCode}: ${data.errorMessage || 'unknown error'}`, { errorCode: String(data.errorCode) });
  }
  return data;
}

// formUrl must point at the payment gateway itself — never let a malformed
// or unexpected answer send the customer somewhere else. Accepted: the API
// host itself, another host of the API's own domain (a bank's proxy such as
// ipayproxy.idp.am may serve the payment page from a sibling host), or ArCa.
const baseDomain = (hostname) => hostname.toLowerCase().split('.').slice(-2).join('.');
function isGatewayUrl(value) {
  let url;
  try { url = new URL(String(value)); } catch { return false; }
  let api;
  try { api = new URL(getApiUrl()); } catch { return false; }
  if (url.protocol === api.protocol && url.hostname === api.hostname) return true;
  if (url.protocol !== 'https:') return false;
  return baseDomain(url.hostname) === baseDomain(api.hostname) || /(^|\.)arca\.am$/i.test(url.hostname);
}

// register.do — one-phase payment. failUrl is the same address as
// returnUrl: either way the server checks the real status with ArCa.
export async function registerOrder({ orderNumber, amountAmd, returnUrl, description, language }) {
  const params = {
    orderNumber: String(orderNumber),
    amount: String(toMinorUnits(amountAmd)),
    currency: CURRENCY_AMD,
    returnUrl,
    failUrl: returnUrl,
    description: String(description || '').slice(0, 99),
    language: toArcaLanguage(language),
  };
  if (isForce3dsEnabled()) params.features = 'FORCE_TDS';
  const data = await callGateway('register.do', params);
  const orderId = String(data.orderId || '');
  const formUrl = String(data.formUrl || '');
  if (!orderId || !formUrl) throw new ArcaError('ArCa register.do answered without orderId/formUrl');
  if (!isGatewayUrl(formUrl)) throw new ArcaError('ArCa register.do answered with an unexpected formUrl');
  return { orderId, formUrl };
}

// getOrderStatusExtended.do — the only source of truth for "was it paid".
export async function getOrderStatus(orderId) {
  const data = await callGateway('getOrderStatusExtended.do', { orderId: String(orderId) });
  const orderStatus = Number(data.orderStatus);
  return {
    orderNumber: String(data.orderNumber ?? ''),
    orderStatus: Number.isInteger(orderStatus) ? orderStatus : null,
    amount: Number(data.amount),
    currency: data.currency === undefined || data.currency === null ? '' : String(data.currency),
    actionCode: data.actionCode ?? null,
    actionCodeDescription: String(data.actionCodeDescription || ''),
    approvalCode: String(data.cardAuthInfo?.approvalCode || ''),
  };
}

// Our orders are registered with register.do (one-phase), where the guide
// defines 1 as "Transaction has been approved" and 2 as "deposited".
export function isPaid(status) {
  return status?.orderStatus === ORDER_STATUS.APPROVED || status?.orderStatus === ORDER_STATUS.DEPOSITED;
}

// Final "no money was taken" states — the pending checkout can be closed.
export function isFailed(status) {
  return [ORDER_STATUS.DECLINED_OTHER, ORDER_STATUS.REVERSED, ORDER_STATUS.REFUNDED, ORDER_STATUS.DECLINED].includes(status?.orderStatus);
}

// Registered but never paid (e.g. the customer cancelled on ArCa's page).
export function isUnpaid(status) {
  return status?.orderStatus === ORDER_STATUS.REGISTERED;
}

// Meaning of the most common actionCode values ("5.5 Response codes" in the
// EPG guide) — for the server log, so a declined test payment says why.
const ACTION_CODES = {
  '-2020': 'invalid ECI in 3-D Secure answer',
  '-2018': '3-D Secure: no connection to the Visa/Mastercard directory server',
  '-2017': '3-D Secure: authentication not confirmed (PARes status is not Y)',
  '-2016': '3-D Secure: issuer could not say if the card is enrolled (VERes U)',
  '-2013': 'no payment attempts left',
  '-2011': '3-D Secure: issuer could not authenticate the card (PARes U)',
  '-2007': 'payment page session expired',
  '-2006': '3-D Secure: issuing bank rejected authentication',
  '-2005': '3-D Secure: issuer signature check failed or status N',
  '-2003': 'blocked by fraud check',
  '-2002': 'amount outside the allowed limits',
  '-2001': 'customer IP is blacklisted',
  '-2000': 'card number is blacklisted',
  '-100': 'no payment attempted yet',
  '-1': 'processing timeout',
  0: 'success',
  5: 'refused by the payment network',
  100: 'card limits — issuer prohibits internet payments on this card',
  101: 'card expired',
  103: 'no connection to the issuing bank',
  111: 'wrong card number',
  116: 'not enough money',
  120: 'refused by the issuing bank',
  121: 'daily limit exceeded',
  125: 'invalid card number',
  910: 'issuing bank is not available',
  999: 'declined by fraud check',
  1001: 'card details not entered yet',
};
export function describeActionCode(actionCode) {
  if (actionCode === null || actionCode === undefined || actionCode === '') return 'no action code';
  return `actionCode ${actionCode}: ${ACTION_CODES[String(actionCode)] || 'see "Response codes" in the EPG guide'}`;
}

// Currency may come back as "051", "51" or 51.
export function isAmd(currency) {
  return currency === '' || Number(currency) === Number(CURRENCY_AMD);
}
