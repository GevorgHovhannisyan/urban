import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// Resized WebP versions of uploaded photos, made on first request and cached
// on disk: /uploads/photo.png?w=800 → a ≤800px-wide WebP. The original file
// is never modified, and anything unexpected (no ?w, unknown width, missing
// file, sharp failure) falls through to the normal static file.
//
// Only a fixed set of widths is allowed, so the cache can't be grown with
// arbitrary sizes. Cached files live in <uploads>/.variants (a dot folder,
// which express.static never serves directly).
export const VARIANT_WIDTHS = [400, 800, 1200, 1600];
const ALLOWED = new Set(VARIANT_WIDTHS);
const SOURCE_NAME = /^[\w.-]+\.(png|jpe?g|jfif|webp)$/i;
const inFlight = new Map();

export function imageVariants(uploadsDir) {
  const cacheDir = path.join(uploadsDir, '.variants');

  return async (req, res, next) => {
    const width = Number(req.query.w);
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!ALLOWED.has(width)) return next();
    let requested;
    try { requested = decodeURIComponent(req.path).slice(1); } catch { return next(); }
    const name = path.basename(requested);
    // Plain file names only — no sub-folders, no "..".
    if (requested !== name || !SOURCE_NAME.test(name)) return next();

    const source = path.join(uploadsDir, name);
    const target = path.join(cacheDir, `${name}.${width}.webp`);
    try {
      const src = await fs.promises.stat(source);
      const cached = await fs.promises.stat(target).catch(() => null);
      if (!cached || cached.mtimeMs < src.mtimeMs) {
        // One conversion per file/width even under concurrent requests.
        if (!inFlight.has(target)) {
          inFlight.set(target, (async () => {
            await fs.promises.mkdir(cacheDir, { recursive: true });
            const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
            await sharp(source)
              .rotate()
              .resize({ width, withoutEnlargement: true })
              .webp({ quality: 78 })
              .toFile(tmp);
            await fs.promises.rename(tmp, target);
          })().finally(() => inFlight.delete(target)));
        }
        await inFlight.get(target);
      }
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.type('image/webp');
      // dotfiles: the cache folder is ".variants" (hidden from express.static).
      return res.sendFile(target, { dotfiles: 'allow' });
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error(`[image-variants] ${name} @${width}: ${error.message}`);
      return next();
    }
  };
}
