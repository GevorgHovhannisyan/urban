// Minimal inline placeholder so a dead/blocked image URL (e.g. an Unsplash
// photo that's been removed) degrades to a quiet muted tile instead of the
// browser's broken-image icon. Kept as a data URI so it never triggers a
// second network request that could also fail.
export const FALLBACK_SRC = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000" viewBox="0 0 800 1000">'
  + '<rect width="800" height="1000" fill="#161616"/>'
  + '<g stroke="#3a3a3a" stroke-width="2">'
  + '<path d="M320 420h160v160H320z" fill="none"/>'
  + '<circle cx="360" cy="460" r="14" fill="none"/>'
  + '<path d="M320 560l50-50 40 40 60-70 70 80" fill="none"/>'
  + '</g>'
  + '</svg>',
);

export function handleImgError(event) {
  const img = event.currentTarget;
  if (img.dataset.fallback === '1') return;
  img.dataset.fallback = '1';
  img.src = FALLBACK_SRC;
}
