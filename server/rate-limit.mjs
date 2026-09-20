// Minimal in-memory sliding-window rate limiter. No external dependency —
// this app runs as a single Node process, so a Map keyed by IP is enough to
// close the "no rate limiting anywhere" gap on auth/spam-prone routes
// (admin/customer login, registration, promo validation, reviews,
// newsletter signup, order tracking). Not meant to survive a multi-instance
// deployment; if this app is ever horizontally scaled, swap this for a
// shared store (Redis) behind the same createRateLimiter() signature.

const buckets = new Map();

// Periodically drop expired buckets so this doesn't grow unbounded under
// sustained traffic from many distinct IPs.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

export function createRateLimiter({ windowMs, max, message }) {
  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const key = `${req.baseUrl}${req.path}:${ip}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({ error: message || 'Too many requests. Please try again shortly.' });
    }
    next();
  };
}
