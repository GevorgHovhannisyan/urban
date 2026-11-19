// SRC (ՊԵԿ) electronic cash register web service client.
// Official manual: uc_hhpek_electronic_HDM_integration_manual_04_2026 (src.am).
//
// Mutual TLS with the register's PKCS12 bundle (HDM_PFX_PATH +
// HDM_PFX_PASSPHRASE). Server certificate AND hostname verification stay ON
// (rejectUnauthorized: true; Node checks the hostname by default). The SRC
// CA root (HDM_CA_PATH) is added to — not instead of — Node's public roots.
//
// Every call returns an `outcome` the caller can act on safely:
//   success  — HTTP response with JSON code 0
//   rejected — SRC answered with a JSON error code: the operation did NOT
//              happen (e.g. 196 inactive register, 201 missing departments)
//   not_sent — failed before the request body was fully handed to the
//              network (DNS, refused, TLS handshake, bad certificate): the
//              server cannot have acted on it, so retrying is safe
//   unknown  — the request went out but no trustworthy answer came back
//              (timeout, reset, proxy 5xx, SRC INTERNAL_ERROR). For `print`
//              this means a receipt MAY exist: never resend blindly —
//              reconcile first (see fiscalService.mjs).
import fs from 'node:fs';
import https from 'node:https';
import tls from 'node:tls';
import { getHdmConfig, missingConnectionSettings } from './config.mjs';

const MAX_RESPONSE_BYTES = 256 * 1024;
const CONNECT_TIMEOUT_MS = 15000;
const RESPONSE_TIMEOUT_MS = { default: 30000, print: 45000 };

export class HdmConfigError extends Error {}

// ---------- transport (replaceable in tests only) ----------
let agentCache = null;

function buildAgent(config) {
  const key = `${config.pfxPath}|${config.caPath}|${fs.statSync(config.pfxPath).mtimeMs}`;
  if (agentCache?.key === key) return agentCache.agent;
  const tlsOptions = {
    pfx: fs.readFileSync(config.pfxPath),
    passphrase: process.env.HDM_PFX_PASSPHRASE,
    ca: config.caPath ? [...tls.rootCertificates, fs.readFileSync(config.caPath, 'utf8')] : undefined,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
  };
  try {
    tls.createSecureContext(tlsOptions); // fail fast on a wrong passphrase / broken bundle
  } catch (error) {
    // Never include the passphrase; Node's message doesn't contain it.
    throw new HdmConfigError(`Cannot load the HDM certificate bundle: ${error.message}`);
  }
  agentCache?.agent.destroy();
  agentCache = { key, agent: new https.Agent({ ...tlsOptions, keepAlive: true, maxSockets: 2 }) };
  return agentCache.agent;
}

function httpsTransport({ url, body, headers, timeoutMs }) {
  const config = getHdmConfig();
  const agent = buildAgent(config);
  return new Promise((resolve) => {
    let bodyFlushed = false;
    let settled = false;
    const done = (value) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };
    const req = https.request(url, {
      method: 'POST',
      agent,
      headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > MAX_RESPONSE_BYTES) res.destroy(new Error('Response too large'));
      });
      res.on('end', () => done({ httpStatus: res.statusCode, text: data }));
      res.on('error', (error) => done({ error, sent: true }));
    });
    req.setTimeout(CONNECT_TIMEOUT_MS, () => req.destroy(Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })));
    req.on('socket', (socket) => {
      // Once connected, switch to the (longer) response timeout.
      socket.once('secureConnect', () => req.setTimeout(timeoutMs, () => req.destroy(Object.assign(new Error(`No response from SRC within ${timeoutMs / 1000}s`), { code: 'ETIMEDOUT' }))));
    });
    req.on('finish', () => { bodyFlushed = true; });
    req.on('error', (error) => done({ error, sent: bodyFlushed }));
    req.end(body);
  });
}

let transport = httpsTransport;

// Tests replace the network layer with a fake SRC. Refused outside tests so
// production can never be pointed at a stub by accident.
export function setTransportForTests(fn) {
  if (process.env.NODE_ENV !== 'test' && !process.env.HDM_ALLOW_TEST_TRANSPORT) {
    throw new Error('setTransportForTests is only available in tests');
  }
  transport = fn || httpsTransport;
}

// Validates the configuration and loads the certificate bundle WITHOUT
// sending anything. Throws HdmConfigError. Called before the dispatch marker
// is written, so a broken certificate can never be mistaken for "sent".
export function prepare() {
  const config = getHdmConfig();
  const missing = missingConnectionSettings(config);
  if (missing.length) throw new HdmConfigError(`HDM is not configured: ${missing.join('; ')}`);
  if (transport === httpsTransport) buildAgent(config);
}

// ---------- calls ----------
// Envoy-style proxy text: "reset reason: connection failure" means the proxy
// never reached SRC (safe to retry); "connection termination" etc. may come
// after the request was forwarded.
const PROXY_NEVER_CONNECTED = /reset reason:\s*(remote\s+)?connection failure|no healthy upstream/i;

function classify(result, { mutating }) {
  if (result.error) {
    const detail = `${result.error.code ? `${result.error.code}: ` : ''}${result.error.message}`;
    if (!result.sent) return { outcome: 'not_sent', error: detail };
    return { outcome: mutating ? 'unknown' : 'not_sent', error: detail };
  }
  let json = null;
  try { json = JSON.parse(result.text); } catch { /* not JSON */ }
  const httpStatus = result.httpStatus;
  if (json && typeof json.code === 'number') {
    if (json.code === 0) return { outcome: 'success', httpStatus, code: 0, result: json.result, raw: json };
    const error = `SRC ${json.code} ${json.message || ''}${json.errorMessage ? `: ${json.errorMessage}` : ''}`.trim();
    // 500 INTERNAL_ERROR on a write is ambiguous (e.g. "Failed to save
    // receipt" after a partial write) — treat as unknown, never as "not done".
    if (json.code === 500 && mutating) return { outcome: 'unknown', httpStatus, code: json.code, message: json.message, error, raw: json };
    return { outcome: 'rejected', httpStatus, code: json.code, message: json.message, errorMessage: json.errorMessage, error, raw: json };
  }
  const snippet = String(result.text || '').replace(/\s+/g, ' ').slice(0, 300);
  const error = `HTTP ${httpStatus}${snippet ? `: ${snippet}` : ''}`;
  if (httpStatus >= 500 && PROXY_NEVER_CONNECTED.test(snippet)) return { outcome: 'not_sent', httpStatus, error };
  if (httpStatus >= 500 || !mutating) return { outcome: mutating ? 'unknown' : 'not_sent', httpStatus, error };
  // 4xx without an SRC JSON body (e.g. a gateway refusing the request
  // outright): the request was not processed by SRC.
  return { outcome: 'rejected', httpStatus, error };
}

async function call(method, payload, { mutating = false } = {}) {
  const config = getHdmConfig();
  const missing = missingConnectionSettings(config);
  if (missing.length) throw new HdmConfigError(`HDM is not configured: ${missing.join('; ')}`);
  const body = JSON.stringify({ crn: config.crn, ...payload });
  const result = await transport({
    method,
    url: `${config.baseUrl}/api/v1.0/${method}`,
    body,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json', language: config.language },
    timeoutMs: RESPONSE_TIMEOUT_MS[method] || RESPONSE_TIMEOUT_MS.default,
  });
  return { method, ...classify(result, { mutating }) };
}

// Read-only.
export const checkConnection = () => call('checkConnection', {});
// Read-only: needs departments to exist, so it doubles as a configuration
// probe (SRC answers 201 MISSING_DEPARTMENTS / 196 INACTIVE_CERT_CRM).
export const getGoodList = (taxRegime) => call('getGoodList', { taxRegime: Number(taxRegime), tin: getHdmConfig().tin });
// Read-only: an existing receipt by its number (used by reconciliation).
// The manual lists the path as "printCop" in one place and "printCopy" in
// the method name; printCopy is used.
export const printCopy = (receiptId) => call('printCopy', { receiptId: Number(receiptId) });

// State-changing, administrative (never called automatically).
export const activate = () => call('activate', {}, { mutating: true });
export const configureDepartments = (departments) => call('configureDepartments', { departments }, { mutating: true });

// State-changing: issues a fiscal receipt. `payload` excludes crn.
export const print = (payload) => call('print', payload, { mutating: true });
