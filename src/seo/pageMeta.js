// Shared by the browser (src/context/AppContext.jsx) and the server
// (server/seo.mjs), so the <title>/description a crawler gets in the first
// HTML response matches what the SPA sets after it boots. Plain JS only: no
// DOM, no JSX, no browser globals.

export const SITE_NAME = 'Urban Phoenix';
export const DEFAULT_OG_IMAGE = '/images/brand/og-default.jpg';

// Every page name the SPA can render (src/App.jsx). Anything else is a 404.
export const KNOWN_PAGES = new Set(['home', 'shop', 'product', 'collection', 'about', 'cart', 'wishlist', 'search', 'login', 'reset-password', 'account', 'checkout', 'track', 'contact', 'journal', 'journal-post', 'drop', 'gift-cards', 'sizing', 'shipping', 'faq', 'privacy', 'terms', 'cookies', 'campaign', 'refund', 'cancellation', 'legal', 'contact-info', 'receipt']);

// Public pages listed in /sitemap.xml (products and journal articles are
// added from the database). Private/transactional pages are left out.
export const SITEMAP_PAGES = ['home', 'shop', 'collection', 'about', 'journal', 'campaign', 'gift-cards', 'contact', 'track', 'sizing', 'faq', 'shipping', 'refund', 'cancellation', 'terms', 'privacy', 'cookies', 'legal', 'contact-info'];

// `name` becomes "<name> | Urban Phoenix"; descriptions are ~150–160 chars.
export const PAGE_META = {
  home: { title: 'Urban Phoenix | Freedom To Become', description: 'Urban Phoenix is streetwear from Armenia for those who refuse to stay who they were: heavyweight oversized hoodies, tees and sweatshirts from Collection 001.' },
  shop: { name: 'Shop All', description: 'Shop all Urban Phoenix streetwear: heavyweight oversized hoodies, tees, sweatshirts and longsleeves from Armenia, with delivery to Armenia, the USA and Russia.' },
  collection: { name: 'Collection 001', description: 'Collection 001 — Freedom To Become. Heavyweight Urban Phoenix silhouettes, controlled proportions and minimal graphics for those who choose evolution.' },
  about: { name: 'About', description: 'The story behind Urban Phoenix: an Armenian streetwear label built from chaos for the few, making heavyweight oversized pieces for those who never stand still.' },
  cart: { name: 'Your Bag', description: 'Review the Urban Phoenix pieces in your bag, adjust sizes and quantities, and continue to secure checkout with delivery to Armenia, the United States or Russia.' },
  wishlist: { name: 'Wishlist', description: 'Your saved Urban Phoenix pieces in one place. Keep track of the hoodies, tees and sweatshirts you love and move them to your bag before limited drops sell out.' },
  search: { name: 'Search', description: 'Search the Urban Phoenix store for hoodies, tees, sweatshirts and longsleeves. Find your size and fit across Collection 001 and the latest limited drops.' },
  login: { name: 'Sign In', description: 'Sign in or create your Urban Phoenix account to track orders, save addresses and your wishlist, collect UP Society points and check out faster on every order.' },
  'reset-password': { name: 'Reset Password', description: 'Reset the password for your Urban Phoenix account. Choose a new password to get back to your orders, saved addresses, wishlist and UP Society member points.' },
  account: { name: 'My Account', description: 'Manage your Urban Phoenix account: view orders and their status, update your profile and saved addresses, see your wishlist and your UP Society points balance.' },
  checkout: { name: 'Checkout', description: 'Complete your Urban Phoenix order securely. Choose delivery to Armenia, the USA or Russia and pay in Armenian dram (AMD) by bank card via ArCa or with Idram.' },
  track: { name: 'Track Your Order', description: 'Track your Urban Phoenix order. Enter your order number and email to see its current status, from payment and dispatch to delivery by HayPost, ONEX or CDEK.' },
  contact: { name: 'Contact', description: 'Contact Urban Phoenix customer support about orders, sizing, delivery, returns or collaborations. Send us a message or email support@urbanphoenix.am for help.' },
  journal: { name: 'Journal', description: 'The Urban Phoenix Journal: stories on Armenian streetwear, oversized hoodie fit and fabric, garment care guides and the people and ideas behind each collection.' },
  drop: { name: 'New Drop', description: 'The latest Urban Phoenix limited drop. Follow the release countdown, see the limited-edition pieces coming next and shop them the moment they go live online.' },
  'gift-cards': { name: 'Buy a Gift Card', description: 'Give an Urban Phoenix gift card. Choose an amount, add a personal message and send it by email, redeemable on any hoodie, tee or sweatshirt in the online store.' },
  sizing: { name: 'Sizing Guide', description: 'Urban Phoenix sizing guide: chest and length measurements for every size from XS to XXL, plus how to measure a garment you own to choose your oversized fit.' },
  faq: { name: 'FAQ', description: 'Answers to common Urban Phoenix questions: when orders ship, delivery times in Armenia and abroad, how the oversized fit runs, order changes and where we ship.' },
  campaign: { name: 'Campaign 001', description: 'Campaign 001 — Freedom To Become: a study of movement, pressure and self-definition, following people through the city without asking permission to belong.' },
  shipping: { name: 'Shipping Policy', description: 'Urban Phoenix shipping policy: delivery across Armenia by HayPost, door to door in the USA and to CDEK branches in Russia, with delivery times and rates.' },
  refund: { name: 'Refund Policy', description: 'Urban Phoenix refund policy: return eligible items within 15 days of delivery, item condition requirements, damaged or wrong orders, and how refunds are issued.' },
  cancellation: { name: 'Order Cancellation Policy', description: 'How to cancel an Urban Phoenix order: free cancellation within 24 hours before dispatch, cancellations in transit, cash on delivery orders and how refunds work.' },
  terms: { name: 'Terms of Service', description: 'The Urban Phoenix terms of service covering limited-edition products, orders, pricing and payments in AMD, shipping, returns, size selection and liability.' },
  privacy: { name: 'Privacy Policy', description: 'How Urban Phoenix collects, uses, stores and protects your personal data, which cookies we use, who we share data with, and your rights, incl. account deletion.' },
  cookies: { name: 'Cookie Preferences', description: 'Manage your cookie preferences on Urban Phoenix. See which essential cookies keep your bag, language and currency working and which optional ones you control.' },
  legal: { name: 'Legal Notice', description: 'Urban Phoenix legal notice: the company behind the store, legal address in Yerevan, Armenia, contact details and the terms that apply to using this website.' },
  'contact-info': { name: 'Contact Information', description: 'Urban Phoenix contact information: support phone and email, working hours (Armenia time) and our legal address at 16, 1st Lane, Tichina, Yerevan, Armenia.' },
  receipt: { name: 'Tax Receipt', description: 'Your Urban Phoenix electronic cash register (ՀԴՄ) receipt, registered with the State Revenue Committee of Armenia, with its fiscal number and QR code.' },
  'not-found': { name: 'Page Not Found', description: "The page you're looking for doesn't exist or may have moved. Return to the Urban Phoenix homepage to shop heavyweight oversized streetwear from Armenia." },
};

export function pageTitle(name) {
  return name ? `${name} | ${SITE_NAME}` : SITE_NAME;
}

// Trims long text (product descriptions, article excerpts) to a meta
// description: whitespace collapsed, cut at a word boundary, max 160 chars.
export function metaDescription(text, max = 160) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}

export function staticPageMeta(page) {
  const meta = PAGE_META[page] || PAGE_META['not-found'];
  return { title: meta.title || pageTitle(meta.name), description: meta.description };
}

// Collection 001 has its own CMS SEO fields (Admin → Site Content →
// Collections → Collection 001 → SEO). An admin-entered value wins; the old
// built-in default title counts as "not set" so it follows the site format.
const LEGACY_COLLECTION_TITLE = 'Collection 001 — Urban Phoenix';
export function collectionPageMeta(collectionSeo) {
  const base = staticPageMeta('collection');
  const customTitle = collectionSeo?.seoTitle?.trim();
  return {
    title: customTitle && customTitle !== LEGACY_COLLECTION_TITLE ? customTitle : base.title,
    description: collectionSeo?.seoDescription?.trim() || base.description,
    image: collectionSeo?.seoImage || collectionSeo?.heroImageUrl || undefined,
  };
}

export function productPageMeta(product) {
  if (!product) return staticPageMeta('not-found');
  // Products can share the same short description, so lead with the name
  // and top up toward ~155 chars with brand/delivery facts.
  const name = String(product.name || '').trim().replace(/[.\s]+$/, '');
  let description = metaDescription(product.description ? `${name} — ${product.description}` : '');
  if (!description) return { title: pageTitle(product.name), description: PAGE_META.shop.description, image: product.images?.[0] || DEFAULT_OG_IMAGE };
  const extras = [' Urban Phoenix streetwear from Armenia.', ' Delivery to Armenia, the USA and Russia.', ' By Urban Phoenix.'];
  for (const extra of extras) {
    if (extra === extras[2] && description.includes('Urban Phoenix')) break;
    if (description.length + extra.length <= 160) description += extra;
  }
  return {
    title: pageTitle(product.name),
    description,
    image: product.images?.[0] || DEFAULT_OG_IMAGE,
  };
}

export function journalPostMeta(post) {
  if (!post) return staticPageMeta('not-found');
  return {
    title: pageTitle(post.title),
    description: metaDescription(post.excerpt || post.body) || PAGE_META.journal.description,
    image: post.coverImage || DEFAULT_OG_IMAGE,
  };
}

export function pageToPath(page, data, selectedProduct) {
  if (page === 'home') return '/';
  if (page === 'product') {
    const id = data?.product?.id || data?.id || selectedProduct?.id;
    return id ? `/product/${encodeURIComponent(id)}` : '/shop';
  }
  if (page === 'receipt' && data?.orderNumber) {
    return `/receipt/${encodeURIComponent(data.orderNumber)}`;
  }
  if (page === 'journal-post') {
    const slug = data?.slug;
    return slug ? `/journal/${encodeURIComponent(slug)}` : '/journal';
  }
  return `/${page}`;
}

export function pathToPageInfo(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return { page: 'home' };
  const productMatch = clean.match(/^\/product\/([^/]+)$/);
  if (productMatch) return { page: 'product', productId: safeDecode(productMatch[1]) };
  const receiptMatch = clean.match(/^\/receipt\/([^/]+)$/);
  if (receiptMatch) return { page: 'receipt', orderNumber: safeDecode(receiptMatch[1]) };
  const journalMatch = clean.match(/^\/journal\/([^/]+)$/);
  if (journalMatch) return { page: 'journal-post', slug: safeDecode(journalMatch[1]) };
  // Idram's SUCCESS_URL / FAIL_URL — handled by the checkout page.
  const paymentReturnMatch = clean.match(/^\/payment\/(success|fail)$/);
  if (paymentReturnMatch) return { page: 'checkout', paymentReturn: paymentReturnMatch[1] };
  return { page: clean.slice(1) };
}

function safeDecode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}
