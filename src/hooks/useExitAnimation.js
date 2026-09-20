import { useEffect, useState } from 'react';

// Shared mount/unmount-with-exit-animation state machine for overlays that
// currently do `if (!open) return null` (Search, Cart, mobile menu) — that
// pattern unmounts instantly on close, so there's no DOM left for a CSS
// exit transition to animate. This keeps the component mounted for
// `duration` ms after `open` goes false (tagged with `closing: true` so the
// caller can swap to a reverse/exit class), then actually unmounts.
//
// Purely local component state — never touches routing, cart data, or any
// other app state, so it's safe to drop into any overlay independently.
export function useExitAnimation(open, duration = 320) {
  const [rendered, setRendered] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setRendered(true);
      setClosing(false);
      return undefined;
    }
    if (!rendered) return undefined;
    setClosing(true);
    const timer = setTimeout(() => {
      setRendered(false);
      setClosing(false);
    }, duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, duration]);

  return { rendered, closing };
}
