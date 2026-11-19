// Electronic cash register (ՀԴՄ / HDM) configuration — backend only.
//
// Read from process.env on every call (never cached at import time), so it
// works no matter when dotenv runs relative to this module, and a value
// changed for a test applies immediately. Secrets (the PKCS12 passphrase)
// are only ever handed to Node's TLS layer: never logged, never returned by
// describeHdmConfig(), never sent to the browser.
//
// Business settings (department, tax regime, ADG code, cashier, shipping and
// discount handling) are deliberately NOT defaulted: a receipt is a tax
// document, so a missing setting blocks fiscalization with a clear reason
// instead of guessing.
import fs from 'node:fs';
import path from 'node:path';

const env = (key) => String(process.env[key] ?? '').trim();
const flag = (key) => /^(1|true|yes|on)$/i.test(env(key));

export const TAX_REGIMES = {
  1: 'VAT taxable (ԱԱՀ-ով հարկվող)',
  2: 'Not VAT taxable (ԱԱՀ-ով չհարկվող)',
  3: 'Turnover tax (Շրջանառության հարկ)',
  7: 'Micro-enterprise (Միկրոձեռնարկատիրություն)',
};

export function getHdmConfig() {
  const department = Number(env('HDM_DEPARTMENT'));
  const cashierId = Number(env('HDM_CASHIER_ID'));
  const taxRegime = Number(env('HDM_TAX_REGIME'));
  return {
    enabled: flag('HDM_ENABLED'),
    crn: env('HDM_CRN'),
    tin: env('HDM_TIN'),
    baseUrl: (env('HDM_BASE_URL') || 'https://ecrm.taxservice.am/taxsystem-rs-vcr').replace(/\/+$/, ''),
    pfxPath: env('HDM_PFX_PATH'),
    caPath: env('HDM_CA_PATH'),
    hasPassphrase: Boolean(env('HDM_PFX_PASSPHRASE')),
    language: env('HDM_LANGUAGE') || 'en',
    // Which verified online payments get a receipt.
    providers: (env('HDM_PROVIDERS') || 'arca,idram').split(',').map((p) => p.trim().toLowerCase()).filter(Boolean),
    // Business settings (must be confirmed by the business/accountant).
    department: Number.isInteger(department) && department > 0 ? department : null,
    taxRegime: TAX_REGIMES[taxRegime] ? taxRegime : null,
    adgCode: env('HDM_ADG_CODE') || null,
    cashierId: Number.isInteger(cashierId) && cashierId > 0 ? cashierId : null,
    unit: env('HDM_UNIT') || null,
    shippingAdgCode: env('HDM_SHIPPING_ADG_CODE') || null,
    shippingGoodCode: env('HDM_SHIPPING_GOOD_CODE') || 'DELIVERY',
    shippingGoodName: env('HDM_SHIPPING_GOOD_NAME') || 'Առաքում',
    shippingDepartment: Number(env('HDM_SHIPPING_DEPARTMENT')) || null,
    // 'line_total' = order-level discounts (promo code, UP Society points)
    // are spread over the item lines as SRC discountType 4 (TOTAL).
    discountMode: env('HDM_DISCOUNT_MODE') || null,
    // Receipt numbers below this are ignored by reconciliation (e.g. test
    // receipts issued on this register before the website went live).
    receiptIdFloor: Number(env('HDM_RECEIPT_ID_FLOOR')) || 0,
  };
}

// Settings that must exist before ANY call to SRC can be made.
export function missingConnectionSettings(config = getHdmConfig()) {
  const missing = [];
  if (!/^\d{8}$/.test(config.crn)) missing.push('HDM_CRN (8-digit register number)');
  if (!config.pfxPath) missing.push('HDM_PFX_PATH');
  else if (!path.isAbsolute(config.pfxPath)) missing.push('HDM_PFX_PATH must be an absolute path');
  else if (!fs.existsSync(config.pfxPath)) missing.push(`HDM_PFX_PATH file not found (${config.pfxPath})`);
  if (!config.hasPassphrase) missing.push('HDM_PFX_PASSPHRASE');
  if (config.caPath && !fs.existsSync(config.caPath)) missing.push(`HDM_CA_PATH file not found (${config.caPath})`);
  if (!/^https:\/\//i.test(config.baseUrl)) missing.push('HDM_BASE_URL must be https://');
  return missing;
}

// Settings that must exist before a sale receipt can be built.
export function missingReceiptSettings(config = getHdmConfig()) {
  const missing = [];
  if (!config.department) missing.push('HDM_DEPARTMENT (register department number for clothing)');
  if (!config.adgCode) missing.push('HDM_ADG_CODE (ԱՏԳ code for the products sold)');
  if (!config.cashierId) missing.push('HDM_CASHIER_ID (cashier number to print receipts under)');
  if (!config.unit) missing.push('HDM_UNIT (unit of measure printed on the receipt, e.g. հատ)');
  return missing;
}

// Safe to log and to return to the admin: names and presence only.
export function describeHdmConfig() {
  const config = getHdmConfig();
  const connection = missingConnectionSettings(config);
  const receipt = missingReceiptSettings(config);
  let message;
  if (!config.enabled) message = 'HDM receipts are OFF (HDM_ENABLED is not true) — no fiscal receipts are created.';
  else if (connection.length) message = `HDM is ON but cannot connect — missing: ${connection.join('; ')}.`;
  else if (receipt.length) message = `HDM is ON; receipts will wait ("blocked") until set: ${receipt.join('; ')}.`;
  else message = `HDM is ON (CRN ${config.crn}, department ${config.department}).`;
  return {
    enabled: config.enabled,
    crn: config.crn || null,
    tin: config.tin || null,
    baseUrl: config.baseUrl,
    providers: config.providers,
    department: config.department,
    taxRegime: config.taxRegime,
    taxRegimeLabel: config.taxRegime ? TAX_REGIMES[config.taxRegime] : null,
    adgCode: config.adgCode,
    cashierId: config.cashierId,
    unit: config.unit,
    shippingConfigured: Boolean(config.shippingAdgCode),
    discountMode: config.discountMode,
    missingConnectionSettings: connection,
    missingReceiptSettings: receipt,
    message,
  };
}
