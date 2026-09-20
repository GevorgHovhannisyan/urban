import express from 'express';
import jwt from 'jsonwebtoken';
import { get } from './db.mjs';
import { login, requireAdmin } from './auth.mjs';
import { JWT_SECRET } from './password.mjs';
import {
  listProducts, getProduct, createProduct, updateProduct, deleteProduct, listDropTeasers,
} from './products-api.mjs';
import { createOrder, trackOrder, listOrdersByEmail, listOrders, updateOrderStatus, FREE_US_SHIPPING_THRESHOLD } from './order-api.mjs';
import { listDeliveryMethods } from './delivery.mjs';
import {
  listReviews, createReview, getReviewEligibility, updateOwnReview, deleteOwnReview, listAllReviews, moderateReview, deleteReview,
} from './review-api.mjs';
import { listEditions, listAllEditionSales, releaseEdition } from './edition-api.mjs';
import {
  validatePromoCode, listPromoCodes, createPromoCode, updatePromoCode, deletePromoCode,
} from './promo-api.mjs';
import { checkGiftCard, createGiftCard, listGiftCards, setGiftCardActive, getGiftCard, listGiftCardTransactions, resendGiftCardEmail } from './gift-card-api.mjs';
import { getLoyaltyPoints, pointsValueInDollars } from './loyalty.mjs';
import { createReturnRequest, listMyReturnRequests, listAllReturnRequests, updateReturnStatus } from './returns-api.mjs';
import { listPublishedPosts, getPostBySlug, listAllPosts, createPost, updatePost, deletePost } from './journal-api.mjs';
import { getSummary, getRevenueOverTime, getTopProducts, getSalesByCategory, getOrderStatusBreakdown } from './reports-api.mjs';
import { registerCustomer, loginCustomer, requireCustomer, listCustomers, verifyCode, resendVerification, requestPasswordReset, resetPassword } from './customer-auth.mjs';
import * as accountApi from './account-api.mjs';
import { subscribe, listSubscribers, deleteSubscriber } from './newsletter-api.mjs';
import { getSiteContent, updateSiteContentSection } from './content-api.mjs';
import { submitContactForm } from './contact-api.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { uploadsDir, uploadImage, uploadVideo, verifyUploadedFileContent, readImageDimensions, ALLOWED_IMAGE_TYPES, ALLOWED_VIDEO_TYPES } from './uploads.mjs';
import { recordMedia, listMedia, updateMediaAlt, deleteMedia, getMediaUsageById } from './media-api.mjs';
import fs from 'node:fs';
import {
  createPayment, updatePaymentAmount, getPaymentStatus, handleWebhook,
  isPaymentConfigured, getPaymentPublicKey, getPaymentEnv, getProviderName,
  createGiftCardPayment, getGiftCardPaymentStatus,
} from './payment/paymentService.mjs';

// Auth endpoints get a tight limit (brute-force protection); everything else
// gets a looser one just to blunt spam/scraping without bothering real users.
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts. Please wait a few minutes and try again.' });
const writeLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many requests. Please wait a few minutes and try again.' });
const readLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 60, message: 'Too many requests. Please try again shortly.' });

// Everything the storefront and the admin panel need from the backend, shared
// verbatim between `node server.mjs` (production, serves the built dist/) and
// the Vite dev server (server/vite-api-plugin.mjs mounts this same app as
// middleware) so the live preview behaves identically to production instead
// of only supporting a hand-picked subset of routes.
// allowFraming: only ever passed true by the Vite dev plugin, so the Figma
// Make preview panel (which embeds this app in an iframe during development
// — see AGENTS.md) keeps working. The real production entry point
// (server.mjs) calls createApp() with no options, which locks framing down —
// a production deployment has no legitimate reason to be iframed, and
// disallowing it is standard clickjacking protection every major retailer's
// site has.
export function createApp({ allowFraming = false } = {}) {
  const app = express();
  // Framework fingerprint — trivial for an attacker to use when looking up
  // known Express-specific vulnerabilities. No functional purpose.
  app.disable('x-powered-by');

  // Controls what Express trusts from X-Forwarded-For when computing
  // req.ip — which is what the rate limiter (server/rate-limit.mjs) keys
  // on. Deliberately NOT hardcoded to `true` here: blindly trusting
  // X-Forwarded-For without knowing the real proxy topology lets any client
  // spoof that header and claim any IP it wants, defeating rate limiting
  // entirely. Configurable via TRUST_PROXY so the value can match whatever
  // actually sits in front of this app in production:
  //   - unset (default): Express's own default (false) — req.ip is the
  //     direct socket address. Correct for local dev/preview and for a
  //     deployment with NO reverse proxy in front of it.
  //   - "1" (a number): trust exactly N hops of X-Forwarded-For — use "1"
  //     for a single reverse proxy/load balancer directly in front of this
  //     app (e.g. nginx, a single-region Fly.io/Render/Railway deployment).
  //   - "loopback": trust only proxies on 127.0.0.0/8, ::1, etc. — use this
  //     if the proxy runs on the same machine.
  //   - a specific IP/CIDR (or comma-separated list): trust only that exact
  //     proxy — the safest option when you know the proxy's address (e.g.
  //     a specific load balancer IP range), matches Express's own
  //     "trust proxy" string format.
  //   - "true": trust the whole chain — only appropriate behind a CDN like
  //     Cloudflare that already strips/rewrites client-supplied
  //     X-Forwarded-For, so the leftmost value is trustworthy.
  // See Express's trust proxy docs for the full value grammar this passes
  // straight through to.
  const trustProxySetting = process.env.TRUST_PROXY;
  if (trustProxySetting !== undefined && trustProxySetting !== '') {
    if (trustProxySetting === 'true') app.set('trust proxy', true);
    else if (trustProxySetting === 'false') app.set('trust proxy', false);
    else if (/^\d+$/.test(trustProxySetting)) app.set('trust proxy', Number(trustProxySetting));
    else app.set('trust proxy', trustProxySetting);
  }
  // A small, hand-written set of security headers rather than pulling in
  // helmet for a handful of values, matching this app's existing
  // no-extra-dependency style (see the custom rate limiter).
  //
  // The Content-Security-Policy below was written after auditing every
  // external origin this app actually loads (grepped the whole frontend):
  //   - images.unsplash.com        product/marketing imagery
  //   - fonts.googleapis.com/gstatic.com   webfonts
  //   - js.stripe.com / api.stripe.com / hooks.stripe.com   Stripe.js + Elements + 3DS
  //   - ipapi.co                   visitor-country geolocation (fetch, already try/catch'd)
  // No inline <script> tags, no eval/new Function, and no
  // dangerouslySetInnerHTML anywhere in the frontend (verified), so
  // script-src omits 'unsafe-inline'/'unsafe-eval' entirely — the strongest
  // useful setting. style-src keeps 'unsafe-inline' because React's style
  // prop and Tailwind's generated stylesheet both rely on it; that's the
  // standard, accepted tradeoff for a CSP on a React app without a
  // nonce-based build step, and is far lower-risk than allowing inline
  // scripts. frame-ancestors (the CSP mechanism for clickjacking protection,
  // superseding X-Frame-Options) is set from allowFraming so it stays
  // permissive in the Figma dev preview and locked down everywhere else.
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://images.unsplash.com",
    "connect-src 'self' https://api.stripe.com https://ipapi.co",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${allowFraming ? '*' : "'none'"}`,
  ].join('; ');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', csp);
    if (!allowFraming) res.setHeader('X-Frame-Options', 'DENY');
    // Only takes effect over HTTPS — browsers ignore it on plain HTTP, so
    // this is a no-op in local dev and only matters once actually deployed.
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    // Disables browser features this storefront never uses, so a future XSS
    // or a compromised third-party script can't abuse them.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), usb=(), payment=(self "https://js.stripe.com")');
    next();
  });
  // Captures the raw request bytes alongside normal JSON parsing so the
  // Stripe webhook route can verify Stripe's signature against the exact
  // bytes it sent — signature verification fails against a re-serialized
  // (parsed-then-stringified) body, which won't byte-for-byte match.
  app.use(express.json({ limit: '1mb', verify: (req, res, buf) => { req.rawBody = buf; } }));

  // Admin-uploaded images (Site Content banners, community grid, etc.) —
  // served from data/uploads rather than dist/, so they survive a rebuild.
  app.use('/uploads', express.static(uploadsDir));

  // ---------- Public API ----------
  const publicApi = express.Router();

  publicApi.get('/products', async (req, res) => {
    res.json({ products: await listProducts({ isLoggedIn: Boolean(optionalCustomerId(req)) }) });
  });
  publicApi.get('/products/:id', async (req, res) => {
    const isLoggedIn = Boolean(optionalCustomerId(req));
    const product = await getProduct(req.params.id, { isLoggedIn });
    if (!product || product.archived) return res.status(404).json({ error: 'Product not found.' });
    if (!product.isPurchasable) return res.status(404).json({ error: 'Product not found.' });
    res.json({ product });
  });

  publicApi.get('/editions', async (req, res) => {
    const result = await listEditions(req.query.productId || '');
    res.status(result.status).json(result.body);
  });

  // Verified Purchase Reviews: resolves the same decoded JWT payload
  // requireCustomer() would (role checked, signature verified), but returns
  // null instead of sending a 401 when there's no/an invalid token — the
  // eligibility check below is meant to work for guests too (it just always
  // answers "not_authenticated" for them), unlike POST /reviews itself,
  // which still hard-requires a real session via requireCustomer().
  function optionalCustomer(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return null;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return payload.role === 'customer' ? payload : null;
    } catch {
      return null;
    }
  }

  publicApi.get('/reviews', async (req, res) => {
    const result = await listReviews(req.query.productId || '');
    res.status(result.status).json(result.body);
  });
  // Lets the product page render the correct state (sign-in prompt /
  // "purchase required" / the reviewer's own review / a fresh form) without
  // guessing — the same purchase check createReview() enforces, exposed
  // read-only so the two can never disagree.
  publicApi.get('/reviews/eligibility', async (req, res) => {
    const customer = optionalCustomer(req);
    const result = await getReviewEligibility(customer, req.query.productId || '');
    res.status(result.status).json(result.body);
  });
  publicApi.post('/reviews', writeLimiter, async (req, res) => {
    const customer = requireCustomer(req, res);
    if (!customer) return; // response already sent
    const result = await createReview(req.body, customer);
    res.status(result.status).json(result.body);
  });
  publicApi.put('/reviews/:id', writeLimiter, async (req, res) => {
    const customer = requireCustomer(req, res);
    if (!customer) return; // response already sent
    const result = await updateOwnReview(req.params.id, req.body || {}, customer);
    res.status(result.status).json(result.body);
  });
  publicApi.delete('/reviews/:id', writeLimiter, async (req, res) => {
    const customer = requireCustomer(req, res);
    if (!customer) return; // response already sent
    const result = await deleteOwnReview(req.params.id, customer);
    res.status(result.status).json(result.body);
  });

  // Best-effort: resolve a customer id from an optional Bearer token without
  // rejecting the request if it's missing/invalid — these routes work for
  // guests too, they just link the order to an account when one is present.
  function optionalCustomerId(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return null;
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      return payload.role === 'customer' ? payload.sub : null;
    } catch {
      return null;
    }
  }

  publicApi.post('/orders', async (req, res) => {
    const result = await createOrder({ ...req.body, customerId: optionalCustomerId(req) });
    res.status(result.status).json(result.body);
  });
  publicApi.get('/orders/track/:orderNumber', readLimiter, async (req, res) => {
    const result = await trackOrder(req.params.orderNumber);
    res.status(result.status).json(result.body);
  });

  // Publishable key is not secret (it's designed to ship to the browser) —
  // served from an endpoint rather than baked into the frontend build so it
  // can be changed via .env without a rebuild, same as every other payment
  // config value. paymentEnv/paymentProvider are informational only — they
  // let the frontend show a subtle "sandbox" indicator during testing (never
  // fake payment UI — see server/payment-config-guard.mjs for the boot-time
  // guard that keeps this value honest) and automatically disappear once
  // PAYMENT_ENV=production.
  publicApi.get('/config', (req, res) => {
    res.json({
      stripePublishableKey: getPaymentPublicKey(),
      stripeConfigured: isPaymentConfigured(),
      freeUsShippingThreshold: FREE_US_SHIPPING_THRESHOLD,
      paymentProvider: getProviderName(),
      paymentEnv: getPaymentEnv(),
    });
  });

  // Delivery costs are always computed server-side from server/delivery.mjs —
  // country/city/subtotal are query parameters only so the checkout UI can
  // preview accurate prices before submitting; the order itself is priced
  // again, independently, from the same module at order-creation time (see
  // order-api.mjs's validateOrderDraft) — this endpoint is never trusted as
  // the source of truth for what gets charged.
  publicApi.get('/delivery-methods', (req, res) => {
    const { country = '', city = '', subtotal = '0' } = req.query;
    res.json({ methods: listDeliveryMethods({ country: String(country), city: String(city), subtotal: Number(subtotal) || 0 }) });
  });

  publicApi.post('/checkout/payment-intent', writeLimiter, async (req, res) => {
    const result = await createPayment({ ...req.body, customerId: optionalCustomerId(req) });
    res.status(result.status).json(result.body);
  });
  publicApi.patch('/checkout/payment-intent/:pendingCheckoutId', writeLimiter, async (req, res) => {
    const result = await updatePaymentAmount(req.params.pendingCheckoutId, { ...req.body, customerId: optionalCustomerId(req) });
    res.status(result.status).json(result.body);
  });
  publicApi.get('/checkout/payment-intent/:pendingCheckoutId/status', readLimiter, async (req, res) => {
    const result = await getPaymentStatus(req.params.pendingCheckoutId);
    res.status(result.status).json(result.body);
  });

  publicApi.post('/auth/register', authLimiter, async (req, res) => {
    const result = await registerCustomer(req.body || {});
    res.status(result.status).json(result.body);
  });
  publicApi.post('/auth/login', authLimiter, async (req, res) => {
    const result = await loginCustomer(req.body || {});
    res.status(result.status).json(result.body);
  });
  publicApi.post('/auth/resend-verification', authLimiter, async (req, res) => {
    const result = await resendVerification((req.body || {}).email);
    res.status(result.status).json(result.body);
  });
  publicApi.post('/auth/request-password-reset', authLimiter, async (req, res) => {
    const result = await requestPasswordReset((req.body || {}).email);
    res.status(result.status).json(result.body);
  });
  publicApi.post('/auth/reset-password', authLimiter, async (req, res) => {
    const result = await resetPassword(req.body || {});
    res.status(result.status).json(result.body);
  });
  publicApi.post('/auth/verify-code', authLimiter, async (req, res) => {
    const { email, code } = req.body || {};
    const result = await verifyCode(email, code);
    res.status(result.status).json(result.body);
  });
  publicApi.get('/orders/mine', async (req, res) => {
    const customer = requireCustomer(req, res);
    if (!customer) return; // response already sent
    const result = await listOrdersByEmail(customer.email);
    res.status(result.status).json(result.body);
  });

  publicApi.post('/promo/validate', writeLimiter, async (req, res) => {
    const { code, subtotal } = req.body || {};
    const result = await validatePromoCode(code, Number(subtotal) || 0);
    if (!result.valid) return res.status(400).json({ valid: false, error: result.error });
    res.json({ valid: true, discountAmount: result.discountAmount, code: result.promo.code, type: result.promo.type, value: result.promo.value });
  });

  publicApi.get('/drops', async (req, res) => res.json({ drops: await listDropTeasers() }));

  publicApi.get('/journal', async (req, res) => res.json({ posts: await listPublishedPosts() }));
  publicApi.get('/journal/:slug', async (req, res) => {
    const post = await getPostBySlug(req.params.slug);
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    res.json({ post });
  });

  publicApi.post('/gift-cards/check', writeLimiter, async (req, res) => {
    const result = await checkGiftCard((req.body || {}).code);
    if (!result.valid) return res.status(400).json({ valid: false, error: result.error });
    // balanceUsd is what checkout math actually uses (orders are always
    // USD-denominated internally) — balance/currency are the card's own
    // native units, returned so the UI can tell the shopper what their
    // card is actually worth without doing its own currency conversion.
    res.json({
      valid: true,
      code: result.giftCard.code,
      currency: result.giftCard.currency,
      balance: result.giftCard.balance,
      balanceUsd: result.giftCard.balanceUsd,
    });
  });

  publicApi.post('/gift-cards/purchase', writeLimiter, async (req, res) => {
    const result = await createGiftCardPayment(req.body || {});
    res.status(result.status).json(result.body);
  });
  publicApi.get('/gift-cards/purchase/:pendingCheckoutId/status', readLimiter, async (req, res) => {
    const result = await getGiftCardPaymentStatus(req.params.pendingCheckoutId);
    res.status(result.status).json(result.body);
  });

  publicApi.post('/newsletter/subscribe', writeLimiter, async (req, res) => {
    const result = await subscribe((req.body || {}).email);
    res.status(result.status).json(result.body);
  });

  publicApi.post('/contact', writeLimiter, async (req, res) => {
    const { name, email, topic, message } = req.body || {};
    const result = await submitContactForm({ name, email, topic, message });
    res.status(result.status).json(result.body);
  });

  publicApi.get('/content', async (req, res) => res.json({ content: await getSiteContent() }));

  publicApi.get('/health', (req, res) => res.json({ ok: true }));

  app.use('/api', publicApi);

  // ---------- Payment provider webhook ----------
  // Not rate-limited (the provider's own retry behavior shouldn't be
  // throttled) and authenticated by signature verification
  // (paymentService.handleWebhook), not by any of this app's own auth —
  // that's the whole point of the raw body. Idempotent by construction — see
  // paymentService.mjs's doc comment on handleWebhook.
  app.post('/api/stripe/webhook', async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const result = await handleWebhook(req.rawBody, signature);
    res.status(result.status).json(result.body);
  });

  // ---------- Account API (authenticated customers) ----------
  const accountRouter = express.Router();
  accountRouter.use((req, res, next) => {
    const customer = requireCustomer(req, res);
    if (!customer) return; // response already sent
    req.customer = customer;
    next();
  });

  accountRouter.get('/overview', async (req, res) => {
    const result = await accountApi.getOverview(req.customer.sub);
    res.status(result.status).json(result.body);
  });
  accountRouter.get('/limited-pieces', async (req, res) => {
    const result = await accountApi.getLimitedPieces(req.customer.sub);
    res.status(result.status).json(result.body);
  });

  accountRouter.get('/profile', async (req, res) => {
    const result = await accountApi.getProfile(req.customer.sub);
    res.status(result.status).json(result.body);
  });
  accountRouter.patch('/profile', async (req, res) => {
    const result = await accountApi.updateProfile(req.customer.sub, req.body || {});
    res.status(result.status).json(result.body);
  });
  accountRouter.post('/change-password', async (req, res) => {
    const result = await accountApi.changePassword(req.customer.sub, req.body || {});
    res.status(result.status).json(result.body);
  });

  accountRouter.get('/addresses', async (req, res) => {
    const result = await accountApi.listAddresses(req.customer.sub);
    res.status(result.status).json(result.body);
  });
  accountRouter.post('/addresses', async (req, res) => {
    const result = await accountApi.createAddress(req.customer.sub, req.body || {});
    res.status(result.status).json(result.body);
  });
  accountRouter.put('/addresses/:id', async (req, res) => {
    const result = await accountApi.updateAddress(req.customer.sub, req.params.id, req.body || {});
    res.status(result.status).json(result.body);
  });
  accountRouter.delete('/addresses/:id', async (req, res) => {
    const result = await accountApi.deleteAddress(req.customer.sub, req.params.id);
    res.status(result.status).json(result.body);
  });
  accountRouter.post('/addresses/:id/default', async (req, res) => {
    const result = await accountApi.setDefaultAddress(req.customer.sub, req.params.id);
    res.status(result.status).json(result.body);
  });

  accountRouter.get('/preferences', async (req, res) => {
    const result = await accountApi.getPreferences(req.customer.sub);
    res.status(result.status).json(result.body);
  });
  accountRouter.put('/preferences', async (req, res) => {
    const result = await accountApi.updatePreferences(req.customer.sub, req.body || {});
    res.status(result.status).json(result.body);
  });

  accountRouter.get('/wishlist', async (req, res) => {
    const result = await accountApi.listWishlist(req.customer.sub);
    res.status(result.status).json(result.body);
  });
  accountRouter.post('/wishlist', async (req, res) => {
    const result = await accountApi.addWishlistItem(req.customer.sub, (req.body || {}).productId);
    res.status(result.status).json(result.body);
  });
  accountRouter.delete('/wishlist/:productId', async (req, res) => {
    const result = await accountApi.removeWishlistItem(req.customer.sub, req.params.productId);
    res.status(result.status).json(result.body);
  });
  accountRouter.post('/wishlist/merge', async (req, res) => {
    const result = await accountApi.mergeWishlist(req.customer.sub, (req.body || {}).productIds || []);
    res.status(result.status).json(result.body);
  });

  accountRouter.get('/returns', async (req, res) => {
    res.json({ returnRequests: await listMyReturnRequests(req.customer.email) });
  });
  accountRouter.post('/returns', async (req, res) => {
    const result = await createReturnRequest(req.customer.email, req.body || {});
    res.status(result.status).json(result.body);
  });

  app.use('/api/account', accountRouter);

  // ---------- Admin API ----------
  const adminApi = express.Router();

  adminApi.post('/login', authLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    const result = await login(email, password);
    if (result.error) return res.status(401).json({ error: result.error });
    res.json({ token: result.token, email: result.email });
  });

  adminApi.use((req, res, next) => {
    const admin = requireAdmin(req, res);
    if (!admin) return; // response already sent
    req.admin = admin;
    next();
  });

  adminApi.get('/customers', async (req, res) => res.json({ customers: await listCustomers() }));

  adminApi.get('/newsletter', async (req, res) => res.json({ subscribers: await listSubscribers() }));
  adminApi.delete('/newsletter/:id', async (req, res) => {
    const result = await deleteSubscriber(req.params.id);
    res.status(result.status).json(result.body);
  });

  adminApi.get('/overview', async (req, res) => {
    const [productCount, orderCount, reviewCount, revenue, pendingOrders, customerCount, subscriberCount] = await Promise.all([
      get('SELECT COUNT(*) c FROM products WHERE archived = 0').then((r) => r.c),
      get('SELECT COUNT(*) c FROM orders').then((r) => r.c),
      get("SELECT COUNT(*) c FROM reviews WHERE status = 'published'").then((r) => r.c),
      get("SELECT COALESCE(SUM(total), 0) r FROM orders WHERE status != 'cancelled'").then((r) => Number(r.r)),
      get("SELECT COUNT(*) c FROM orders WHERE status = 'payment_pending'").then((r) => r.c),
      get('SELECT COUNT(*) c FROM customers').then((r) => r.c),
      get('SELECT COUNT(*) c FROM newsletter_subscribers').then((r) => r.c),
    ]);
    res.json({ productCount, orderCount, reviewCount, revenue, pendingOrders, customerCount, subscriberCount });
  });

  adminApi.get('/products', async (req, res) => res.json({ products: await listProducts({ includeArchived: true }) }));
  adminApi.post('/products', async (req, res) => {
    const result = await createProduct(req.body);
    res.status(result.status).json(result.body);
  });
  adminApi.put('/products/:id', async (req, res) => {
    const result = await updateProduct(req.params.id, req.body);
    res.status(result.status).json(result.body);
  });
  adminApi.delete('/products/:id', async (req, res) => {
    const result = await deleteProduct(req.params.id);
    res.status(result.status).json(result.body);
  });

  adminApi.get('/orders', async (req, res) => res.json({ orders: await listOrders() }));
  adminApi.patch('/orders/:id', async (req, res) => {
    const result = await updateOrderStatus(req.params.id, req.body || {});
    res.status(result.status).json(result.body);
  });

  adminApi.get('/returns', async (req, res) => res.json({ returnRequests: await listAllReturnRequests() }));
  adminApi.patch('/returns/:id', async (req, res) => {
    const result = await updateReturnStatus(req.params.id, (req.body || {}).status);
    res.status(result.status).json(result.body);
  });

  adminApi.get('/journal', async (req, res) => res.json({ posts: await listAllPosts() }));
  adminApi.post('/journal', async (req, res) => {
    const result = await createPost(req.body);
    res.status(result.status).json(result.body);
  });
  adminApi.put('/journal/:id', async (req, res) => {
    const result = await updatePost(req.params.id, req.body);
    res.status(result.status).json(result.body);
  });
  adminApi.delete('/journal/:id', async (req, res) => {
    const result = await deletePost(req.params.id);
    res.status(result.status).json(result.body);
  });

  adminApi.get('/reports/summary', async (req, res) => res.json(await getSummary()));
  adminApi.get('/reports/revenue', async (req, res) => res.json({ series: await getRevenueOverTime(req.query.days) }));
  adminApi.get('/reports/top-products', async (req, res) => res.json({ products: await getTopProducts(req.query.limit) }));
  adminApi.get('/reports/sales-by-category', async (req, res) => res.json({ categories: await getSalesByCategory() }));
  adminApi.get('/reports/order-status', async (req, res) => res.json({ statuses: await getOrderStatusBreakdown() }));

  adminApi.get('/reviews', async (req, res) => res.json({ reviews: await listAllReviews() }));
  adminApi.patch('/reviews/:id', async (req, res) => {
    const result = await moderateReview(req.params.id, req.body || {});
    res.status(result.status).json(result.body);
  });
  adminApi.delete('/reviews/:id', async (req, res) => {
    const result = await deleteReview(req.params.id);
    res.status(result.status).json(result.body);
  });

  adminApi.get('/editions', async (req, res) => res.json({ editions: await listAllEditionSales() }));
  adminApi.delete('/editions/:productId/:number', async (req, res) => {
    const result = await releaseEdition(req.params.productId, req.params.number);
    res.status(result.status).json(result.body);
  });

  adminApi.get('/promo-codes', async (req, res) => res.json({ promoCodes: await listPromoCodes() }));
  adminApi.post('/promo-codes', async (req, res) => {
    const result = await createPromoCode(req.body);
    res.status(result.status).json(result.body);
  });
  adminApi.put('/promo-codes/:id', async (req, res) => {
    const result = await updatePromoCode(req.params.id, req.body);
    res.status(result.status).json(result.body);
  });
  adminApi.delete('/promo-codes/:id', async (req, res) => {
    const result = await deletePromoCode(req.params.id);
    res.status(result.status).json(result.body);
  });

  adminApi.get('/gift-cards', async (req, res) => res.json({ giftCards: await listGiftCards() }));
  adminApi.post('/gift-cards', async (req, res) => {
    const result = await createGiftCard(req.body);
    res.status(result.status).json(result.body);
  });
  adminApi.put('/gift-cards/:id/active', async (req, res) => {
    const result = await setGiftCardActive(req.params.id, Boolean((req.body || {}).active));
    res.status(result.status).json(result.body);
  });
  adminApi.get('/gift-cards/:id/transactions', async (req, res) => {
    const card = await getGiftCard(req.params.id);
    if (!card) return res.status(404).json({ error: 'Gift card not found.' });
    res.json({ transactions: await listGiftCardTransactions(req.params.id) });
  });
  adminApi.post('/gift-cards/:id/resend-email', writeLimiter, async (req, res) => {
    const result = await resendGiftCardEmail(req.params.id);
    res.status(result.status).json(result.body);
  });

  adminApi.get('/content', async (req, res) => res.json({ content: await getSiteContent() }));
  // Read-only reference for Site Content → Shipping & Delivery — the REAL,
  // currently-active estimates/fees from server/delivery.mjs (the single
  // authoritative source), shown so an admin editing that section's intro
  // copy can see what's actually being honored without that copy ever being
  // able to override it. Not editable through this endpoint or any other.
  adminApi.get('/shipping-reference', async (req, res) => {
    res.json({
      zones: [
        { label: 'Yerevan', methods: listDeliveryMethods({ country: 'AM', city: 'Yerevan', subtotal: 0 }) },
        { label: 'Armenia — other regions', methods: listDeliveryMethods({ country: 'AM', city: 'Gyumri', subtotal: 0 }) },
        { label: 'United States (under $150)', methods: listDeliveryMethods({ country: 'US', city: '', subtotal: 0 }) },
        { label: 'United States ($150+)', methods: listDeliveryMethods({ country: 'US', city: '', subtotal: 150 }) },
      ],
    });
  });
  adminApi.put('/content/:section', async (req, res) => {
    const result = await updateSiteContentSection(req.params.section, req.body || {});
    res.status(result.status).json(result.body);
  });

  adminApi.post('/uploads', (req, res) => {
    uploadImage(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Could not upload file.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file was uploaded.' });
        return;
      }
      // multer's fileFilter only checked the client-claimed Content-Type —
      // verify the actual bytes on disk match a real image format before
      // trusting it (see uploads.mjs's verifyUploadedFileContent comment).
      if (!verifyUploadedFileContent(req.file.path, ALLOWED_IMAGE_TYPES)) {
        // Deleting must complete before the response goes out — this file
        // was just proven to not be a real image (e.g. an HTML/script
        // payload spoofed as .jpg), and /uploads serves it back to
        // browsers. A fire-and-forget unlink() lets the client see the
        // rejection while the file still briefly exists on disk.
        fs.unlink(req.file.path, () => {
          res.status(400).json({ error: 'This file does not appear to be a valid image.' });
        });
        return;
      }
      const url = `/uploads/${req.file.filename}`;
      // Media Library row — best-effort: a upload must still succeed and
      // return its URL even if this bookkeeping insert somehow fails, since
      // the file is already safely on disk and every other content field
      // only ever needs the URL string, never this row.
      let media = null;
      try {
        const dimensions = readImageDimensions(req.file.path, req.file.mimetype) || {};
        media = await recordMedia({
          filename: req.file.filename, url, mimeType: req.file.mimetype, kind: 'image',
          width: dimensions.width, height: dimensions.height, sizeBytes: req.file.size,
        });
      } catch { /* non-fatal, see above */ }
      res.json({ url, media });
    });
  });
  adminApi.post('/uploads/video', (req, res) => {
    uploadVideo(req, res, async (err) => {
      if (err) {
        res.status(400).json({ error: err.message || 'Could not upload video.' });
        return;
      }
      if (!req.file) {
        res.status(400).json({ error: 'No file was uploaded.' });
        return;
      }
      if (!verifyUploadedFileContent(req.file.path, ALLOWED_VIDEO_TYPES)) {
        // See the matching image-upload comment above — the delete must
        // finish before the client is told the file was rejected.
        fs.unlink(req.file.path, () => {
          res.status(400).json({ error: 'This file does not appear to be a valid video.' });
        });
        return;
      }
      const url = `/uploads/${req.file.filename}`;
      let media = null;
      try {
        media = await recordMedia({ filename: req.file.filename, url, mimeType: req.file.mimetype, kind: 'video', sizeBytes: req.file.size });
      } catch { /* non-fatal, see above */ }
      res.json({ url, media });
    });
  });

  // Media Library — lists/manages metadata for files already uploaded via
  // the two routes above. Never a second storage path: deleting here also
  // deletes the underlying file (server/media-api.mjs), and every field is
  // read-only except alt text.
  adminApi.get('/media', async (req, res) => res.json({ media: await listMedia() }));
  adminApi.get('/media/:id/usage', async (req, res) => {
    const result = await getMediaUsageById(req.params.id);
    res.status(result.status).json(result.body);
  });
  adminApi.put('/media/:id', async (req, res) => {
    const result = await updateMediaAlt(req.params.id, req.body?.alt);
    res.status(result.status).json(result.body);
  });
  adminApi.delete('/media/:id', async (req, res) => {
    const result = await deleteMedia(req.params.id, { force: req.query.force === '1' });
    res.status(result.status).json(result.body);
  });

  app.use('/api/admin', adminApi);

  // ---------- Unmatched API routes ----------
  // Without this, a request to a nonexistent /api/* endpoint fell through
  // every router above and reached the SPA catch-all that server.mjs/the
  // Vite dev plugin append after createApp() — returning a 200 with
  // index.html's HTML instead of a proper 404, which silently broke any
  // client-side error handling that expected JSON. Scoped to /api so it
  // never intercepts real page routes (those still fall through to the SPA
  // catch-all, which is correct — it's how client-side routing works).
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found.' });
  });

  // ---------- Sitemap (generated from the live catalog, not a static file,
  // so newly added/edited products show up without a rebuild) ----------
  app.get('/sitemap.xml', async (req, res) => {
    const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const staticPaths = ['/', '/shop', '/collection', '/about', '/contact'];
    const productPaths = (await listProducts({ isLoggedIn: false })).map((p) => `/product/${encodeURIComponent(p.id)}`);
    const urls = [...staticPaths, ...productPaths]
      .map((path) => `  <url><loc>${base}${path}</loc></url>`)
      .join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  // Note: /admin and /admin/* are intentionally NOT handled here — the admin
  // panel is now part of the React SPA (src/admin/AdminApp.jsx), served by
  // the same catch-all that serves the storefront (in server.mjs / the Vite
  // dev plugin). Only the /api/admin/* JSON routes above are backend-only.

  // ---------- Error handling ----------
  // Without this, an uncaught exception anywhere above (a malformed JSON
  // body, an unexpected DB error, a bug in a handler) falls through to
  // Express's default error handler, which returns a full stack trace in
  // the response body whenever NODE_ENV isn't "production". Catch
  // everything here instead and only ever send a generic message to the
  // client; the real error still goes to the server log.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error(err);
    const isBadJson = err.type === 'entity.parse.failed' || err instanceof SyntaxError;
    const status = isBadJson ? 400 : (Number.isInteger(err.status) ? err.status : 500);
    res.status(status).json({ error: isBadJson ? 'Invalid request body.' : 'Something went wrong. Please try again.' });
  });

  return app;
}
