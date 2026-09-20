// Tiny shared helper — several modules (admin-config-guard, mailer) need to
// know whether this is a production run, and importing this instead of each
// reading process.env.NODE_ENV directly keeps the definition of "production"
// in exactly one place.
export function isProduction() {
  return process.env.NODE_ENV === 'production';
}
