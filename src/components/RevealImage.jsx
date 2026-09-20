import { useEffect, useRef, useState } from 'react';
import { handleImgError } from '../utils/imageFallback';

// Branded image load reveal: starts slightly blurred/scaled/dim and settles
// to sharp/full opacity once the browser has actually decoded the image.
// Cached images (img.complete already true when this mounts, e.g. revisits
// or images the browser prefetched) skip the reveal entirely — checked
// synchronously on mount so there's never an artificial delay on an image
// that's already sitting in the browser's cache.
export default function RevealImage({ src, alt = '', wrapperClassName = '', className = '', style, ...imgProps }) {
  const imgRef = useRef(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLoaded(Boolean(imgRef.current?.complete));
  }, [src]);

  return (
    <div className={`reveal-img ${loaded ? 'is-loaded' : ''} ${wrapperClassName}`} style={style}>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        onLoad={() => setLoaded(true)}
        onError={handleImgError}
        className={`reveal-img__el ${className}`}
        {...imgProps}
      />
    </div>
  );
}
