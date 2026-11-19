// srcset/sizes for photos uploaded through the admin (/uploads/*.png|jpg|webp).
// The server turns /uploads/x.png?w=800 into a ≤800px WebP
// (server/image-variants.mjs), so the browser downloads only the size it
// needs instead of the multi-MB original. Anything else (external URLs,
// SVGs, data: URIs, already-sized assets) is returned unchanged.
const WIDTHS = [400, 800, 1200, 1600];
const UPLOAD_PHOTO = /^\/uploads\/[^/?#]+\.(png|jpe?g|jfif|webp)$/i;

export function variantUrl(src, width) {
  return src && UPLOAD_PHOTO.test(src) ? `${src}?w=${width}` : src;
}

// Spread onto an <img>: {...responsiveImage(src, '(min-width: 1024px) 33vw, 100vw')}
export function responsiveImage(src, sizes = '100vw', maxWidth = 1600) {
  if (!src || !UPLOAD_PHOTO.test(src)) return { src };
  const widths = WIDTHS.filter((w) => w <= maxWidth);
  return {
    src: `${src}?w=${widths[widths.length - 1]}`,
    srcSet: widths.map((w) => `${src}?w=${w} ${w}w`).join(', '),
    sizes,
  };
}
