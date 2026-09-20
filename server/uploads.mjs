import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import multer from "multer";

// Uploaded admin images live in data/uploads (next to the SQLite db), not
// public/ — public/ gets snapshotted into dist/ at build time, so anything
// uploaded after a build would vanish from production. app.mjs serves this
// directory directly under /uploads so it works identically in dev and prod.
// Uploaded admin media is stored in public/uploads and served at /uploads.
export const uploadsDir = path.join(process.cwd(), "public", "uploads");
fs.mkdirSync(uploadsDir, { recursive: true });

export const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
]);
export const ALLOWED_VIDEO_TYPES = new Set(["video/mp4", "video/webm"]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext =
      path
        .extname(file.originalname)
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, "") || ".jpg";
    cb(null, `${Date.now()}_${crypto.randomBytes(6).toString("hex")}${ext}`);
  },
});

export const uploadImage = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      cb(new Error("Only JPEG, PNG, WEBP, GIF, or AVIF images are allowed."));
      return;
    }
    cb(null, true);
  },
}).single("file");

// Separate multer instance (higher size cap) for the handful of spots that
// accept short video clips (e.g. the hero and shop-menu backgrounds) — kept
// distinct from uploadImage so a stray video upload can't silently blow past
// the intentionally tight image size limit.
export const uploadVideo = multer({
  storage,
  limits: { fileSize: 60 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_VIDEO_TYPES.has(file.mimetype)) {
      cb(new Error("Only MP4 or WEBM videos are allowed."));
      return;
    }
    cb(null, true);
  },
}).single("file");

// multer's fileFilter only ever sees the Content-Type header the client
// (browser) sends — an attacker who controls the request can claim
// "image/jpeg" for any file at all. This checks the actual bytes on disk
// against each allowed format's real magic-number signature after the
// upload completes, so a mislabeled file (e.g. HTML/SVG-with-script
// masquerading as a JPEG, which — served back from /uploads with a sniffed
// content type — could otherwise become a stored-XSS vector) gets rejected
// and deleted instead of silently accepted. Deliberately hand-rolled rather
// than a new dependency, matching this app's existing no-extra-dependency
// style for exactly this kind of check (see the custom rate limiter).
const MAGIC_BYTES = [
  { mime: "image/jpeg", bytes: [0xff, 0xd8, 0xff] },
  {
    mime: "image/png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  { mime: "image/gif", bytes: [0x47, 0x49, 0x46, 0x38] }, // GIF8(7a|9a)
  {
    mime: "image/webp",
    bytes: [0x52, 0x49, 0x46, 0x46],
    offset: 0,
    extra: { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8 },
  }, // RIFF....WEBP
  { mime: "image/avif", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // ....ftyp (ISO BMFF box)
  { mime: "video/mp4", bytes: [0x66, 0x74, 0x79, 0x70], offset: 4 }, // same ISO BMFF container family as avif/mp4
  { mime: "video/webm", bytes: [0x1a, 0x45, 0xdf, 0xa3] }, // EBML header (Matroska/WebM)
];

function matchesSignature(buf, sig) {
  const offset = sig.offset || 0;
  const primary = sig.bytes.every((b, i) => buf[offset + i] === b);
  if (!primary) return false;
  if (!sig.extra) return true;
  return sig.extra.bytes.every((b, i) => buf[sig.extra.offset + i] === b);
}

// Returns true if the file's actual bytes match ANY of the signatures for
// the given allowed-mimetype set (not just the one the client claimed) —
// deliberately permissive across the whole allowed set rather than requiring
// an exact match to the claimed mimetype, since some encoders produce
// slightly different but equally valid container variants.
export function verifyUploadedFileContent(filePath, allowedMimeTypes) {
  const fd = fs.openSync(filePath, "r");
  const buf = Buffer.alloc(16);
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  return MAGIC_BYTES.some(
    (sig) => allowedMimeTypes.has(sig.mime) && matchesSignature(buf, sig),
  );
}

// Best-effort width/height for the Media Library's "Dimensions" column —
// hand-rolled (no image library dependency, matching this file's existing
// style) by reading each format's own fixed-offset header field, never by
// decoding the actual pixels. Covers the three formats whose dimensions
// live in a simple, well-documented fixed byte offset (PNG/GIF/JPEG); WEBP's
// three sub-formats and AVIF's ISO-BMFF box structure need real parsing to
// do honestly, so those return null rather than a guessed/wrong value —
// "dimensions where available" is allowed to mean "not always available."
function readPngDimensions(buf) {
  if (buf.length < 24) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
function readGifDimensions(buf) {
  if (buf.length < 10) return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}
function readJpegDimensions(buf) {
  // Walk marker segments looking for a Start-Of-Frame marker (0xC0-0xCF,
  // excluding the DHT/JPG/DAC markers 0xC4/0xC8/0xCC which aren't SOF) —
  // its payload's bytes 1-4 (after the 1-byte precision field) are height
  // then width, big-endian.
  let offset = 2; // skip the 0xFFD8 SOI marker
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    if (
      marker === 0xd8 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9) break; // EOI
    const segmentLength = buf.readUInt16BE(offset + 2);
    const isSOF =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isSOF) {
      return {
        width: buf.readUInt16BE(offset + 7),
        height: buf.readUInt16BE(offset + 5),
      };
    }
    offset += 2 + segmentLength;
  }
  return null;
}

export function readImageDimensions(filePath, mimeType) {
  try {
    // A JPEG's SOF marker isn't guaranteed to sit in the first few bytes
    // (EXIF/ICC segments can precede it), so this one reads a generous
    // chunk rather than the fixed 32 bytes PNG/GIF's fixed-offset fields need.
    const bytesNeeded = mimeType === "image/jpeg" ? 65536 : 32;
    const buf = Buffer.alloc(bytesNeeded);
    const fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buf, 0, bytesNeeded, 0);
    fs.closeSync(fd);
    const slice = buf.subarray(0, bytesRead);
    if (mimeType === "image/png") return readPngDimensions(slice);
    if (mimeType === "image/gif") return readGifDimensions(slice);
    if (mimeType === "image/jpeg") return readJpegDimensions(slice);
    return null; // webp/avif — not parsed, see comment above
  } catch {
    return null;
  }
}
