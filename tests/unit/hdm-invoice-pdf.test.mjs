// Unit test for the PDF invoice (server/hdm/invoicePdf.mjs). Pure — no DB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoicePdf } from '../../server/hdm/invoicePdf.mjs';

const receipt = {
  taxpayer: 'Test LLC', address: 'Yerevan', tin: '28028252', fiscal: '52517801', receiptId: '7', crn: '52472841', sn: 'SN1',
  time: Date.UTC(2026, 10, 20, 10, 0, 0), total: 46800, cardAmount: 46800, qr: 'TIN: 28028252, CRN: 52472841, Receipt_ID: 7',
  items: [{ name: 'Freedom To Become L', quantity: 1, unit: 'հատ', price: 50000, discount: 3200 }],
};

test('builds a one-page PDF with an embedded font and the QR image', async () => {
  const pdf = await buildInvoicePdf({ orderNumber: 'UP-TEST-1', orderDate: '20/11/2026', buyerName: 'QA Buyer', buyerEmail: 'qa@example.com', paymentMethod: 'card', receipt });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const raw = pdf.toString('latin1');
  assert.match(raw, /\/Type \/Page\b/);
  assert.match(raw, /DejaVuSans/, 'Armenian-capable font embedded');
  assert.match(raw, /\/Subtype \/Image/, 'QR code image embedded');
});

test('works without a QR code or optional seller fields', async () => {
  const pdf = await buildInvoicePdf({ orderNumber: 'UP-TEST-2', receipt: { ...receipt, qr: null, taxpayer: null, address: null, sn: null } });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

test('with a download link: second QR image and a clickable link to the PDF', async () => {
  const pdfUrl = 'https://urbanphoenix.am/api/receipts/UP-TEST-3/invoice.pdf?t=abc';
  const pdf = await buildInvoicePdf({ orderNumber: 'UP-TEST-3', receipt, pdfUrl });
  const raw = pdf.toString('latin1');
  assert.ok((raw.match(/\/Subtype \/Image/g) || []).length >= 2, 'fiscal QR + download QR');
  assert.ok(raw.includes(`/URI (${pdfUrl})`), 'clickable link to the PDF');
});
