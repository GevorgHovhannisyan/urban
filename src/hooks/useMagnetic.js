import { useEffect, useRef } from 'react';

// Subtle magnetic pull for major CTAs only (spec: never apply everywhere).
// Reads the pointer position directly and writes `transform` straight to
// the DOM node — no React state, so it can run on every mousemove without
// triggering a render. Desktop-with-fine-pointer + no-reduced-motion only.
export function useMagnetic(maxOffset = 4) {
  const ref = useRef(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    if (!window.matchMedia('(pointer: fine)').matches) return undefined;

    const handleMove = (e) => {
      const rect = el.getBoundingClientRect();
      const relX = (e.clientX - rect.left - rect.width / 2) / (rect.width / 2);
      const relY = (e.clientY - rect.top - rect.height / 2) / (rect.height / 2);
      el.style.transform = `translate3d(${relX * maxOffset}px, ${relY * maxOffset}px, 0)`;
    };
    const handleLeave = () => { el.style.transform = ''; };

    el.addEventListener('mousemove', handleMove, { passive: true });
    el.addEventListener('mouseleave', handleLeave, { passive: true });
    return () => {
      el.removeEventListener('mousemove', handleMove);
      el.removeEventListener('mouseleave', handleLeave);
    };
  }, [maxOffset]);

  return ref;
}
