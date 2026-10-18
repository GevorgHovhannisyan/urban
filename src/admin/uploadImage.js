// Shared admin image upload — every admin image field goes through this so
// photos straight from a computer or phone always work:
//   - big photos (camera/phone originals, often 5–20 MB) are resized in the
//     browser to at most MAX_EDGE px and re-encoded, so they're sharp on the
//     site and far under the server's 10 MB image limit (server/uploads.mjs);
//   - files are recognised by extension too, and sent with a correct image
//     type (some systems report JPEGs as "image/jpg" or with no type at all,
//     which the server would otherwise reject);
//   - iPhone HEIC photos are converted when the browser can decode them,
//     otherwise a clear "export as JPG" message is shown;
//   - errors always say what went wrong.

const EXT_TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif' };
const ALLOWED_TYPES = new Set(Object.values(EXT_TYPES));
const MAX_EDGE = 2560;                 // longest side after resizing
const RESIZE_ABOVE_BYTES = 3 * 1024 * 1024;
const SERVER_LIMIT_BYTES = 10 * 1024 * 1024;

const extOf = (name) => String(name || '').toLowerCase().split('.').pop();
const isHeic = (file) => /^image\/hei[cf]/i.test(file.type) || /^(heic|heif)$/.test(extOf(file.name));

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function reencode(file, baseName) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(isHeic(file)
      ? 'This photo is in HEIC format (iPhone). Please export it as JPG or PNG and try again.'
      : 'This image could not be read. Please use a JPG, PNG or WebP file.');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  // WebP keeps transparency and is small; fall back to JPEG where unsupported.
  let blob = await canvasToBlob(canvas, 'image/webp', 0.86);
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await canvasToBlob(canvas, 'image/jpeg', 0.86);
    ext = 'jpg';
  }
  if (!blob) throw new Error('This image could not be processed. Please try another file.');
  return new File([blob], `${baseName}.${ext}`, { type: blob.type });
}

export async function prepareImageForUpload(file) {
  if (!file) throw new Error('No file selected.');
  const baseName = String(file.name || 'image').replace(/\.[^.]+$/, '') || 'image';
  const type = ALLOWED_TYPES.has(file.type) ? file.type : EXT_TYPES[extOf(file.name)];

  if (isHeic(file)) return reencode(file, baseName);
  if (!type) throw new Error('Please choose a JPG, PNG, WebP, GIF or AVIF image.');

  // Animated GIFs can't be resized without losing the animation.
  if (type === 'image/gif') {
    if (file.size > SERVER_LIMIT_BYTES) throw new Error('This GIF is larger than 10 MB. Please use a smaller file.');
    return file.type === type ? file : new File([file], file.name, { type });
  }

  if (file.size > RESIZE_ABOVE_BYTES) return reencode(file, baseName);
  // Small enough — but very large pixel dimensions are still worth shrinking.
  try {
    const bitmap = await createImageBitmap(file);
    const tooBig = Math.max(bitmap.width, bitmap.height) > MAX_EDGE;
    bitmap.close?.();
    if (tooBig) return reencode(file, baseName);
  } catch {
    // Browser can't decode it here (e.g. AVIF in older browsers) — let the
    // server validate the original.
  }
  return file.type === type ? file : new File([file], file.name, { type });
}

// Uploads one image to /api/admin/uploads and returns its "/uploads/..." URL.
export async function uploadAdminImage(token, file) {
  const prepared = await prepareImageForUpload(file);
  const formData = new FormData();
  formData.append('file', prepared);
  let res;
  try {
    res = await fetch('/api/admin/uploads', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: formData });
  } catch {
    throw new Error('Upload failed — could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Your admin session has expired. Please sign in again.');
    if (res.status === 413) throw new Error('This file is too large for the server. Please use a smaller image.');
    throw new Error(data?.error || `Upload failed (HTTP ${res.status}).`);
  }
  if (!data?.url) throw new Error('Upload failed — the server did not return an image address.');
  return data.url;
}
