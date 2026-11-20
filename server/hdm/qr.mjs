// One QR rendering for the fiscal receipt everywhere (receipt page, invoice
// email, PDF). The payload is SRC's `qr` string exactly as returned by
// print/printCopy — never altered, trimmed or re-formatted.
//
// Why these settings (phones failed to recognise the earlier codes):
//   - margin 4: the QR standard's required quiet zone (4 white modules on
//     every side). The old 1-module border — on a dark page — stopped phone
//     cameras from finding the code at all.
//   - one byte-mode segment, error correction L: version 8 (49×49) for a
//     typical receipt instead of 53×53 split into 18 mixed segments; fewer,
//     larger modules and the most widely supported encoding.
//   - pure black on pure white, integer pixels per module for PNGs.
import QRCode from 'qrcode';

const OPTIONS = { errorCorrectionLevel: 'L', margin: 4, color: { dark: '#000000ff', light: '#ffffffff' } };
const segments = (payload) => [{ data: String(payload), mode: 'byte' }];

export function qrInfo(payload) {
  const qr = QRCode.create(segments(payload), OPTIONS);
  return { version: qr.version, modules: qr.modules.size, withQuietZone: qr.modules.size + 2 * OPTIONS.margin };
}

// SVG as a data: URL (receipt page; the site CSP allows data: images).
export async function qrSvgDataUrl(payload) {
  const svg = await QRCode.toString(segments(payload), { ...OPTIONS, type: 'svg' });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// PNG with an exact number of pixels per module (email, PDF).
export function qrPng(payload, pixelsPerModule = 8) {
  return QRCode.toBuffer(segments(payload), { ...OPTIONS, type: 'png', scale: pixelsPerModule });
}

// ---- Download-link QR (separate from the fiscal QR) ----
// A second, clearly labelled QR that opens the invoice PDF — phones act on
// URLs, unlike the fiscal QR's plain-text SRC data. Same quiet zone and
// colours; error correction M (URLs are short, so it stays small).
const LINK_OPTIONS = { ...OPTIONS, errorCorrectionLevel: 'M' };
const linkSegments = (url) => [{ data: String(url), mode: 'byte' }];

export async function linkQrSvgDataUrl(url) {
  const svg = await QRCode.toString(linkSegments(url), { ...LINK_OPTIONS, type: 'svg' });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export function linkQrPng(url, pixelsPerModule = 8) {
  return QRCode.toBuffer(linkSegments(url), { ...LINK_OPTIONS, type: 'png', scale: pixelsPerModule });
}
