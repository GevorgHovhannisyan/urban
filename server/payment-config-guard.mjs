import { isLiveKey, isTestKey } from './payment/providers/stripe.mjs';
import { getPaymentEnv, getProviderName } from './payment/paymentService.mjs';

// Called once at server startup (server.mjs) — throws rather than returning
// a boolean, so a boot with a dangerously mismatched PAYMENT_ENV/credential
// pair can't accidentally be ignored by a caller that forgets to check a
// return value. Mirrors server/admin-config-guard.mjs's pattern.
//
// This is the safety net for the "the only difference between sandbox and
// production is configuration" model: PAYMENT_ENV is a human-set label, and
// the actual Stripe secret key is what really determines whether a charge is
// real. Without this check, a typo (PAYMENT_ENV=production left over from a
// copy-pasted .env while STRIPE_SECRET_KEY is still a test key, or the
// reverse — PAYMENT_ENV=sandbox with a live key pasted in during a rushed
// go-live) would silently either (a) tell customers their production order
// succeeded when no real charge occurred, or (b) place a real live charge
// during what everyone believes is sandbox testing. Both fail loudly at boot
// instead.
export function assertSecurePaymentConfig() {
  if (getProviderName() !== 'stripe') return; // only Stripe's key-prefix convention is checked here today
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return; // unconfigured entirely is a valid state (see stripe.mjs's describeConfig) — nothing to cross-check

  const env = getPaymentEnv();
  if (env === 'production' && isTestKey(secretKey)) {
    throw new Error(
      'Refusing to start: PAYMENT_ENV=production but STRIPE_SECRET_KEY is a TEST key (sk_test_...). ' +
      'A production deployment must use a live secret key (sk_live_...), or customers would believe they paid ' +
      'while no real charge occurred. Set PAYMENT_ENV=sandbox for testing, or paste the real live key.'
    );
  }
  if (env === 'sandbox' && isLiveKey(secretKey)) {
    throw new Error(
      'Refusing to start: PAYMENT_ENV=sandbox but STRIPE_SECRET_KEY is a LIVE key (sk_live_...). ' +
      'Testing with a live key would place real charges. Set PAYMENT_ENV=production if this is intentional, ' +
      'or paste a test key (sk_test_...) for sandbox testing.'
    );
  }
  if (env === 'production' && !process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error(
      'Refusing to start: PAYMENT_ENV=production but STRIPE_WEBHOOK_SECRET is not set. ' +
      'Without it, a paid order can never be verified server-side — see server/payment/providers/stripe.mjs.'
    );
  }
}
