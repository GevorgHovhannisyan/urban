import { useEffect, useState } from 'react';
import { subscribeProductContinuity } from '../utils/productContinuity';

// Mounted once at the App root (sibling of Routes, never unmounted by
// navigation) so the clone's own state survives the exact route swap it's
// animating across — see productContinuity.js for why this couldn't live
// inside ProductCard itself.
export default function ProductContinuityLayer() {
  const [clone, setClone] = useState(null);

  useEffect(() => subscribeProductContinuity((src, rect) => {
    setClone({ src, rect, id: Date.now() });
  }), []);

  useEffect(() => {
    if (!clone) return undefined;
    const timer = setTimeout(() => setClone(null), 480);
    return () => clearTimeout(timer);
  }, [clone]);

  if (!clone) return null;

  return (
    <img
      key={clone.id}
      src={clone.src}
      aria-hidden="true"
      className="product-image-continuity up-photo"
      style={{
        top: clone.rect.top,
        left: clone.rect.left,
        width: clone.rect.width,
        height: clone.rect.height,
      }}
    />
  );
}
