// The fiscal QR must (1) carry SRC's payload byte-for-byte and (2) be
// renderable so phones detect it: 4-module white quiet zone, black on white.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { qrPng, qrSvgDataUrl, qrInfo } from '../../server/hdm/qr.mjs';

const LIVE = 'TIN: 28028252, CRN: 52472841, SERIAL: D62244E, Receipt_ID: 1, Receipt_Time: 11/20/26 3:45:46 PM, FISCAL: 66473307, TOTAL_CASH: 0, TOTAL_NONCASH: 39, PREP_USAGE: 0, PARTIAL: 0, TOTAL: 39';
// The SRC manual's own sample uses the Armenian full stop "։" in the time.
const MANUAL_SAMPLE = 'TIN: 00493113, CRN: 52014201, SERIAL: 2FECD1F8, Receipt_ID: 8, Receipt_Time: 7/16/24 6:34։35 PM, FISCAL: 52517829, TOTAL_CASH: 0, TOTAL_NONCASH: 40,000, PREP_USAGE: 4,000, PARTIAL: 0, TOTAL: 44,000';

async function decodeRaster(buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

for (const [name, payload] of [['live receipt', LIVE], ['manual sample with Armenian punctuation', MANUAL_SAMPLE]]) {
  test(`PNG decodes to the exact SRC payload (${name})`, async () => {
    assert.equal(await decodeRaster(await qrPng(payload, 8)), payload);
  });
  test(`SVG decodes to the exact SRC payload (${name})`, async () => {
    const svg = Buffer.from((await qrSvgDataUrl(payload)).split(',')[1], 'base64');
    assert.equal(await decodeRaster(await sharp(svg, { density: 300 }).png().toBuffer()), payload);
  });
}

test('4-module white quiet zone on every side, pure black on white', async () => {
  const scale = 8;
  const { modules, withQuietZone } = qrInfo(LIVE);
  const { data, info } = await sharp(await qrPng(LIVE, scale)).greyscale().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.width, withQuietZone * scale);
  assert.equal(withQuietZone, modules + 8);
  const px = (x, y) => data[y * info.width + x];
  const border = 4 * scale;
  for (let i = 0; i < info.width; i += 1) {
    for (const [x, y] of [[i, 0], [i, border - 1], [i, info.height - 1], [0, i], [border - 1, i], [info.width - 1, i]]) {
      assert.equal(px(x, y), 255, `quiet zone pixel ${x},${y} is white`);
    }
  }
  assert.equal(px(border, border), 0, 'finder pattern starts right after the quiet zone');
  assert.ok(data.every((v) => v === 0 || v === 255), 'only pure black and pure white');
});

test('typical receipt payload is a version-8 (49×49) code in one byte segment', () => {
  assert.deepEqual(qrInfo(LIVE), { version: 8, modules: 49, withQuietZone: 57 });
});
