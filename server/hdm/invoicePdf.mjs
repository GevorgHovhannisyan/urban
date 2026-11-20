// PDF invoice with the fiscal (ՀԴՄ) receipt data — server/hdm/fiscalService.mjs
// getInvoicePdf(). Everything printed comes from the stored, already-issued
// receipt (and the order's buyer name); generating it never calls SRC.
//
// Font: DejaVu Sans (package dejavu-fonts-ttf, free license, embedded) —
// covers Armenian, Cyrillic and Latin. It has no ֏ glyph, so amounts are
// written "… AMD".
import { createRequire } from 'node:module';
import path from 'node:path';
import PDFDocument from 'pdfkit';
import { qrPng } from './qr.mjs';

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
const FONT = path.join(FONT_DIR, 'DejaVuSans.ttf');
const FONT_BOLD = path.join(FONT_DIR, 'DejaVuSans-Bold.ttf');

const PAYMENT_LABELS = { card: 'Bank card (ArCa)', idram: 'Idram' };
// Printed QR size incl. its white border: ~5.3 cm, ≈0.93 mm per module for a
// typical (49-module) receipt code.
const QR_SIZE = 150;
const amd = (value) => `${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} AMD`;
const yerevanTime = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { timeZone: 'Asia/Yerevan' }) : '—');

export async function buildInvoicePdf({ orderNumber, orderDate, buyerName, buyerEmail, paymentMethod, receipt }) {
  // 10 px per module, placed at QR_SIZE pt (quiet zone included in the image).
  const qrImage = receipt.qr ? await qrPng(receipt.qr, 10) : null;
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Invoice ${orderNumber}`, Author: receipt.taxpayer || 'Urban Phoenix' } });
  doc.registerFont('regular', FONT);
  doc.registerFont('bold', FONT_BOLD);
  const chunks = [];
  doc.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const muted = '#6b6b6b';
  const rule = (y) => doc.moveTo(left, y).lineTo(left + width, y).lineWidth(0.6).strokeColor('#cccccc').stroke();

  // Header
  doc.font('bold').fontSize(20).fillColor('#111111').text('URBAN PHOENIX', left, 48);
  doc.font('regular').fontSize(10).fillColor(muted).text('INVOICE · ՀԴՄ ԿՏՐՈՆ', left, 74);
  doc.font('bold').fontSize(10).fillColor('#111111').text(`Order ${orderNumber}`, left, 48, { width, align: 'right' });
  doc.font('regular').fontSize(9).fillColor(muted).text(`Date: ${orderDate || '—'}`, left, 64, { width, align: 'right' });
  rule(96);

  // Seller / buyer
  let y = 108;
  const col = width / 2 - 8;
  doc.font('bold').fontSize(8).fillColor(muted).text('SELLER', left, y);
  doc.text('BUYER', left + width / 2 + 8, y);
  doc.font('regular').fontSize(10).fillColor('#111111');
  const seller = [receipt.taxpayer || 'Urban Phoenix', receipt.address, receipt.tin ? `ՀՎՀՀ / TIN ${receipt.tin}` : null].filter(Boolean).join('\n');
  const buyer = [buyerName, buyerEmail].filter(Boolean).join('\n') || '—';
  doc.text(seller, left, y + 13, { width: col });
  const sellerBottom = doc.y;
  doc.text(buyer, left + width / 2 + 8, y + 13, { width: col });
  y = Math.max(sellerBottom, doc.y) + 18;

  // Items — amounts in AMD (stated in the headers, so the columns stay narrow).
  const num = (value) => Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const c = [
    { key: 'name', x: 0, w: 0.40, align: 'left', title: 'ITEM' },
    { key: 'qty', x: 0.40, w: 0.10, align: 'right', title: 'QTY' },
    { key: 'price', x: 0.50, w: 0.16, align: 'right', title: 'PRICE, AMD' },
    { key: 'disc', x: 0.66, w: 0.16, align: 'right', title: 'DISCOUNT, AMD' },
    { key: 'amount', x: 0.82, w: 0.18, align: 'right', title: 'AMOUNT, AMD' },
  ];
  const cell = (col, text, top) => doc.text(text, left + width * col.x, top, { width: width * col.w - (col.key === 'name' ? 6 : 0), align: col.align });
  doc.font('bold').fontSize(7.5).fillColor(muted);
  for (const col of c) cell(col, col.title, y);
  y += 14;
  rule(y);
  y += 6;
  doc.font('regular').fontSize(9.5).fillColor('#111111');
  for (const item of receipt.items || []) {
    const line = Number(item.price) * Number(item.quantity) - Number(item.discount || 0);
    const values = {
      name: item.name,
      qty: `${Number(item.quantity)} ${item.unit || ''}`.trim(),
      price: num(item.price),
      disc: Number(item.discount) > 0 ? `−${num(item.discount)}` : '—',
      amount: num(line),
    };
    const top = y;
    let bottom = top;
    for (const col of c) {
      cell(col, values[col.key], top);
      bottom = Math.max(bottom, doc.y);
    }
    y = bottom + 6;
  }
  rule(y);
  y += 10;
  doc.font('bold').fontSize(12).text('Total paid', left, y);
  doc.text(amd(receipt.total), left, y, { width, align: 'right' });
  y += 18;
  doc.font('regular').fontSize(9).fillColor(muted).text(`Payment: ${PAYMENT_LABELS[paymentMethod] || 'Non-cash'} — ${amd(receipt.cardAmount ?? receipt.total)}`, left, y, { width, align: 'right' });
  y += 28;

  // Fiscal block + QR
  rule(y);
  y += 12;
  doc.font('bold').fontSize(8).fillColor(muted).text('ELECTRONIC CASH REGISTER RECEIPT (ՀԴՄ)', left, y);
  y += 14;
  const rows = [
    ['Fiscal number (ՖՀ)', receipt.fiscal || '—'],
    ['Receipt number', receipt.receiptId || '—'],
    ['Register (CRN)', receipt.crn || '—'],
    ['Serial (SN)', receipt.sn || '—'],
    ['Registered', yerevanTime(receipt.time)],
  ];
  doc.font('regular').fontSize(10).fillColor('#111111');
  for (const [label, value] of rows) {
    doc.fillColor(muted).text(label, left, y, { width: 150 });
    doc.fillColor('#111111').text(String(value), left + 150, y, { width: width - 150 - QR_SIZE - 16 });
    y += 16;
  }
  const rowsTop = y - rows.length * 16;
  if (qrImage) doc.image(qrImage, left + width - QR_SIZE, rowsTop - 8, { width: QR_SIZE, height: QR_SIZE });
  y = Math.max(y, qrImage ? rowsTop - 8 + QR_SIZE : y) + 12;
  doc.font('regular').fontSize(8).fillColor(muted).text(
    'This receipt is registered with the State Revenue Committee of the Republic of Armenia. The QR code contains the receipt data issued by SRC.',
    left, y, { width },
  );

  doc.end();
  return done;
}
