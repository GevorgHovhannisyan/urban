// Minimal pub-sub so ProductCard (which is about to unmount the instant
// navigation swaps Shop for the Product page) can hand off the "play this
// clone animation" request to a listener that lives above the route swap —
// see ProductContinuityLayer.jsx, mounted once at the App root. State that
// lived inside ProductCard itself was unmounted in the same React commit as
// the route change (both state updates batch into one render), so the
// portal never got a chance to paint, let alone animate. A component that
// isn't a descendant of whatever page is navigating away doesn't have that
// problem.
let listener = null;

export function subscribeProductContinuity(fn) {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
}

export function triggerProductContinuity(src, rect) {
  listener?.(src, rect);
}
