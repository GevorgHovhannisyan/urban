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

// orderStatus values of getOrderStatusExtended.do
export const ORDER_STATUS = {
  REGISTERED: 0, // registered, not paid yet
  APPROVED: 1, // amount held (two-phase payments only)
  DEPOSITED: 2, // paid
  REVERSED: 3, // authorization reversed
  REFUNDED: 4,
  ACS_AUTH: 5, // 3-D Secure authorization in progress
  DECLINED: 6,
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

export function describeConfig() {
  if (!isConfigured()) {
    return { status: 'unconfigured', message: 'ArCa card payments are not configured (ARCA_USERNAME / ARCA_PASSWORD).' };
  }
  let host = getApiUrl();
  try { host = new URL(host).host; } catch { /* keep the raw value */ }
  const gateway = isTestGateway() ? `TEST gateway ${host}` : `gateway ${host}`;
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
  const data = await callGateway('register.do', {
    orderNumber: String(orderNumber),
    amount: String(toMinorUnits(amountAmd)),
    currency: CURRENCY_AMD,
    returnUrl,
    failUrl: returnUrl,
    description: String(description || '').slice(0, 99),
    language: toArcaLanguage(language),
  });
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

export function isPaid(status) {
  return status?.orderStatus === ORDER_STATUS.DEPOSITED;
}

// Final "no money was taken" states — the pending checkout can be closed.
export function isFailed(status) {
  return [ORDER_STATUS.REVERSED, ORDER_STATUS.REFUNDED, ORDER_STATUS.DECLINED].includes(status?.orderStatus);
}

// Registered but never paid (e.g. the customer cancelled on ArCa's page).
export function isUnpaid(status) {
  return status?.orderStatus === ORDER_STATUS.REGISTERED;
}

// Currency may come back as "051", "51" or 51.
export function isAmd(currency) {
  return currency === '' || Number(currency) === Number(CURRENCY_AMD);
}
