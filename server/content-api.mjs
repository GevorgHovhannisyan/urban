import { all, get, run, fromJson, toJson } from './db.mjs';

// The six sizes SizeGuideDrawer.jsx has always offered — shared source of
// truth for both the default measurement table below and the sanitizer that
// validates an admin's edits to it.
export const SIZE_GUIDE_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
export const SIZE_GUIDE_GARMENT_TYPES = ['tshirt', 'hoodie', 'sweatshirt', 'longsleeve'];

// Today's real, existing measurements (previously hardcoded in
// SizeGuideDrawer.jsx as the one table every garment type shared) — used as
// the starting table for all four garment types below.
function DEFAULT_MEASUREMENTS() {
  return {
    XS: { chest: 56.0, length: 65.0, sleeve: 54.5 },
    S: { chest: 58.5, length: 67.0, sleeve: 56.0 },
    M: { chest: 61.0, length: 69.0, sleeve: 57.5 },
    L: { chest: 63.5, length: 71.0, sleeve: 59.0 },
    XL: { chest: 66.0, length: 73.0, sleeve: 60.5 },
    XXL: { chest: 68.5, length: 75.0, sleeve: 62.0 },
  };
}

// Defaults mirror the copy the storefront ships with, so a fresh install
// (or a section an admin has never touched) always renders something sane —
// the admin panel edits are stored as overrides on top of these. The
// site_content table itself is created by db.mjs's shared schema (initDb()).
const DEFAULTS = {
  announcement: {
    enabled: true,
    // The $150 figure matches server/delivery.mjs's real, supported
    // FREE_US_SHIPPING_THRESHOLD for the 'united_states' zone — not invented.
    // Inclusive ($150+, not "over $150") to match that zone's real >=150
    // qualifiesForFree check, and explicitly "U.S." — this promotion is not
    // worldwide (Armenia already ships free unconditionally; every other
    // country pays the flat international rate regardless of subtotal).
    message: 'Free U.S. shipping on orders $150+',
  },
  homeHero: {
    eyebrow: 'Urban Phoenix',
    headline: 'Freedom To Become',
    subheadline: 'Streetwear built for those who refuse to stay who they were. Heavyweight fabrics, bold silhouettes, uncompromising quality.',
    primaryCtaText: 'Shop Collection',
    secondaryCtaText: 'View Collection 001',
    imageUrl: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=1920&h=1080&fit=crop&auto=format&q=85',
    imageAlt: 'Urban Phoenix Collection 001 campaign photo',
    // Optional — a separate crop/photo for small viewports. HeroSection
    // (src/pages/HomePage.jsx) falls back to imageUrl above when this is
    // blank, so setting only a desktop image never leaves mobile without a
    // background (see task item 8: "if mobile image is empty, fallback to
    // desktop image").
    mobileImageUrl: '',
    // Optional — when set, an autoplaying muted looped video replaces the
    // static hero image (imageUrl still renders as its poster frame while
    // the video loads, and stays as the background if this is left blank).
    videoUrl: '',
  },
  homeBanner: {
    eyebrow: 'Collection 001',
    headline: 'You Do Not Have To\nRemain Who You Were.',
    body: 'Freedom To Become is about leaving behind what no longer defines you. Built with heavyweight fabrics, intentional details, and a character made to evolve.',
    ctaText: 'Explore Collection 001',
    imageUrl: 'https://images.unsplash.com/photo-1523381210434-271e8be1f52b?w=1600&h=900&fit=crop&auto=format&q=85',
    imageAlt: 'Collection 001 campaign photo',
  },
  aboutStory: {
    eyebrow: 'Our Story',
    headline: 'Built On The Belief That You Can Become Anyone',
    body: 'Urban Phoenix was founded on a single idea: clothing should carry the weight of transformation. We design for people rebuilding themselves — one piece, one season, one decision at a time.',
    imageUrl: 'https://images.unsplash.com/photo-1490578474895-699cd4e2cf59?w=1600&h=1067&fit=crop&auto=format&q=85',
    imageAlt: 'Urban Phoenix founder story photo',
  },
  // The homepage's single brand-philosophy statement (HomePage.jsx's
  // BrandStatement) — deliberately just two short fields, matching the
  // "ONE strong statement, not a wall of quotes" homepage-hierarchy work
  // already done. Not the About page's longer Brand Meaning section.
  brandPhilosophy: {
    headline: 'Character Is Built.',
    subline: 'Built from chaos. Made for progress. Worn by individuals.',
  },
  // Backs the video panel in the Shop mega menu (desktop nav dropdown).
  // Blank by default — the menu falls back to a plain wordmark panel until
  // an admin sets a video, same pattern as homeHero.videoUrl.
  shopMenuVideo: {
    videoUrl: '',
    posterUrl: '',
  },
  // Backs the homepage "@UrbanPhoenix" community grid — an admin-managed
  // photo wall instead of a hardcoded array, so new posts/looks can be added
  // without a code change.
  community: {
    images: [
      { id: 'ig1', url: 'https://images.unsplash.com/photo-1539109136881-3be0616acf4b?w=600&h=600&fit=crop&auto=format&q=80', link: '' },
      { id: 'ig2', url: 'https://images.unsplash.com/photo-1523398002811-999ca8dec234?w=600&h=600&fit=crop&auto=format&q=80', link: '' },
      { id: 'ig3', url: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?w=600&h=600&fit=crop&auto=format&q=80', link: '' },
      { id: 'ig4', url: 'https://images.unsplash.com/photo-1541099649105-f69ad21f3246?w=600&h=600&fit=crop&auto=format&q=80', link: '' },
      { id: 'ig5', url: 'https://images.unsplash.com/photo-1509631179647-0177331693ae?w=600&h=600&fit=crop&auto=format&q=80', link: '' },
      { id: 'ig6', url: 'https://images.unsplash.com/photo-1485968579580-b6d095142e6e?w=600&h=600&fit=crop&auto=format&q=80', link: '' },
    ],
  },
  // Editorial content for Collection 001's dedicated page (CollectionPage.jsx)
  // — the product LIST there stays real/dynamic (products.filter by
  // collection, never touched by this), only the surrounding story copy is
  // CMS-driven. Commerce availability is never decided by this content.
  // Every field below maps to one of the Collection 001 page's real 5
  // sections (CollectionPage.jsx) — 01 Hero, 02 Story, 03 Products
  // (editorial framing only — the product LIST stays real/dynamic,
  // products.filter by collection, never touched by this), 04 is a
  // separate section (see collection002 below, since it's editorially
  // "the next collection", not part of Collection 001's own content), 05 SEO.
  // Commerce availability is never decided by anything in this object.
  collection001: {
    // 01 — Hero
    heroEnabled: true,
    heroLabel: 'Urban Phoenix',
    heroHeadline: 'Collection\n001',
    heroSub: 'Freedom To Become. Our debut collection is a declaration — three pieces built for those who choose evolution over comfort.',
    heroCtaLabel: 'Shop All Pieces',
    // One of a small allowlist of real, safe internal destinations — never
    // arbitrary Admin-typed markup/JS (see CollectionPage.jsx's own
    // CTA_DESTINATIONS map, which is the single place these ids resolve to
    // an actual navigate() call).
    heroCtaDestination: 'shop',
    heroImageUrl: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1920&h=1080&fit=crop&auto=format&q=85',
    heroImageAlt: 'Collection 001 campaign hero photo',
    // Optional — falls back to heroImageUrl above when blank, same pattern
    // as homeHero.mobileImageUrl.
    heroMobileImageUrl: '',
    // 02 — The Story
    storyEnabled: true,
    storyEyebrow: 'The Story',
    storyHeadline: 'Freedom\nTo\nBecome.',
    // Blank-line-separated paragraphs — CollectionPage.jsx renders each one
    // as its own <p>, matching the section's original hand-styled prose
    // rhythm without needing rich text/HTML in this field. Add/remove/
    // reorder a paragraph by editing the blank-line-separated text itself.
    storyBody: 'Our first collection begins with one question: who do you want to become?\n\nNot who you were supposed to be. Not who people already know you as. Not who your past says you are.\n\nWho do you choose to become?\n\nFreedom To Become is about the space between who you were and who you are building.\n\nThe weight of what was. The uncertainty of what comes next. And the freedom to decide anyway.',
    // 03 — Products section (editorial framing only)
    productsEnabled: true,
    productsEyebrow: 'Shop The Collection',
    // 'dynamic' (default): CollectionPage.jsx generates "All {count} Pieces"
    // from the real, live product count — never hardcoded. 'custom' uses
    // productsHeadingCustom verbatim instead, for the rare case an admin
    // wants different wording; even then the count itself is never
    // something this CMS can override, only the surrounding wording.
    productsHeadingMode: 'dynamic',
    productsHeadingCustom: '',
    // 05 — SEO (this page's own; product/other-page SEO is out of scope here)
    seoTitle: 'Collection 001 — Urban Phoenix',
    seoDescription: 'Freedom To Become. Urban Phoenix Collection 001 — three pieces built for those who choose evolution over comfort.',
    seoImage: '',
  },
  // 04 — Next Collection Teaser, the closing section of the Collection 001
  // page (CollectionPage.jsx). Kept as its own top-level section (not
  // nested under collection001) since it's editorially about Collection
  // 002, not 001 — but it is that page's 4th section, not a separate page.
  // Status/visibility here is DISPLAY ONLY and can never make Collection
  // 002 purchasable, add it to Shop, or publish its products — that is
  // governed entirely by real product rows/dates (server/products-api.mjs),
  // never by this content.
  collection002: {
    enabled: true,
    eyebrow: 'Collection 002',
    headline: 'Coming\nSoon',
    imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&h=700&fit=crop&auto=format&q=85',
    imageAlt: 'Collection 002 campaign photo',
    // Optional — falls back to imageUrl above when blank.
    mobileImageUrl: '',
    ctaEnabled: false,
    ctaLabel: '',
    ctaDestination: 'shop',
    status: 'coming_soon',
  },
  // Footer.jsx's brand copy — the link lists themselves (Shop/Brand/Help
  // sections) stay structural/hardcoded (see task's own "protect structural
  // components" guidance and MegaMenu.jsx's CATEGORIES being real category
  // ids elsewhere in the app), but the tagline and copyright line are pure
  // marketing copy with no logic tied to them.
  footer: {
    tagline: 'Built from chaos. Built for the few. Collection 001 — Freedom To Become.',
    copyrightName: 'Urban Phoenix',
  },
  // Only rendered when a URL is actually configured (see Footer.jsx) — an
  // empty field means that icon doesn't show at all, never a dead link.
  // Scheme-restricted to http(s) on save (see updateSiteContentSection's
  // isSafeUrl) so this can never become a javascript:/data: link.
  socialLinks: {
    instagram: 'https://www.instagram.com/urbanphoenixofficial/',
    tiktok: 'https://www.tiktok.com/@karenzadelyan328',
    twitter: 'https://x.com/urbanphoenix_',
  },
  // Presentational-only supporting copy for the Shipping Policy page —
  // deliberately does NOT include the actual day-count estimates or prices;
  // those remain authoritative and centralized in server/delivery.mjs (see
  // that module's own comments) and are never duplicated into free text
  // here, so this can never drift from what checkout/orders actually honor.
  shippingInfo: {
    intro: 'Urban Phoenix ships from Armenia to Armenia and the United States. Delivery estimates begin after an order has been processed and dispatched.',
  },
  // Structured measurement tables for SizeGuideDrawer.jsx — keyed by
  // garmentType (the same values GarmentArtwork.jsx already illustrates:
  // tshirt/hoodie/sweatshirt/longsleeve; a product with any other
  // garmentType falls back to tshirt's table, matching that component's own
  // fallback) then by size, each a {chest, length, sleeve} cm measurement.
  // Every type ships with today's real numbers as its starting table — the
  // four types shared identical numbers before this existed, so migrating
  // changes nothing visually until an admin actually differentiates them.
  // Sanitized by sanitizeSizeGuide() below, not the generic per-field loop
  // (this is the one section shaped as nested numeric tables, not flat
  // text/image/array fields).
  sizeGuide: {
    tshirt: DEFAULT_MEASUREMENTS(),
    hoodie: DEFAULT_MEASUREMENTS(),
    sweatshirt: DEFAULT_MEASUREMENTS(),
    longsleeve: DEFAULT_MEASUREMENTS(),
  },
};

const SECTIONS = Object.keys(DEFAULTS);
const clean = (value, max = 4000) => String(value ?? '').trim().slice(0, max);

// Any field ending in Url/Link (imageUrl, videoUrl, ctaLink, an image-array
// item's `link`, socialLinks.instagram, ...) becomes a real href/src
// somewhere on the site — never trust it as plain text. Empty stays empty
// (that's how an image/video/social field gets "unset"); a relative path
// (an /uploads/... URL from this app's own upload endpoint) is allowed
// as-is; anything else must parse as a real http(s) URL. This is what
// stands between "admin pastes a URL" and "admin (or a compromised admin
// session) pastes javascript:alert(1) or data:text/html,..." — rejected
// outright rather than saved, so it can never reach a page as a live link.
const KNOWN_URL_FIELDS = new Set(['instagram', 'tiktok', 'twitter']);
function isUrlField(fieldName) {
  return /url$/i.test(fieldName) || /link$/i.test(fieldName) || KNOWN_URL_FIELDS.has(fieldName);
}

// A CTA "destination" field is never a free-typed URL — it's a page id the
// frontend resolves through its own fixed navigate() map (see
// CollectionPage.jsx's CTA_DESTINATIONS), the same way a real link picker
// in a page builder would offer a closed list of real pages rather than a
// free-text address bar. Anything not in this allowlist falls back to the
// current/default value instead of being saved, so this can never become a
// javascript:/arbitrary string the frontend would have to interpret unsafely.
const CTA_DESTINATIONS = new Set(['shop', 'collection', 'about', 'journal']);
const ENUM_FIELDS = {
  heroCtaDestination: CTA_DESTINATIONS,
  ctaDestination: CTA_DESTINATIONS,
  productsHeadingMode: new Set(['dynamic', 'custom']),
};
function cleanUrlField(value, max) {
  const trimmed = clean(value, max);
  if (!trimmed) return '';
  if (trimmed.startsWith('/')) return trimmed; // this app's own /uploads/... paths
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return trimmed;
  } catch {
    // not a parseable absolute URL at all
  }
  return ''; // unsafe or unparseable scheme — dropped, never saved
}

export async function getSiteContent() {
  const rows = await all('SELECT section, data FROM site_content');
  const overrides = Object.fromEntries(rows.map((row) => [row.section, fromJson(row.data, {})]));
  const result = {};
  for (const section of SECTIONS) {
    result[section] = { ...DEFAULTS[section], ...(overrides[section] || {}) };
  }
  return result;
}

// A real, plausible garment measurement in centimeters — generous enough
// for any real size run, tight enough to catch a fat-fingered or malicious
// value (e.g. a huge number meant to break the layout, or a negative one).
const MEASUREMENT_MIN_CM = 20;
const MEASUREMENT_MAX_CM = 200;
function sanitizeMeasurement(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < MEASUREMENT_MIN_CM || num > MEASUREMENT_MAX_CM) return fallback;
  return Math.round(num * 10) / 10; // one decimal place, matching the existing table's precision
}

// sizeGuide's own shape (garmentType -> size -> {chest,length,sleeve}) is
// nested numeric data, not the flat text/image/array fields the generic
// per-field loop below handles — validated field-by-field here instead so
// a malformed or out-of-range payload can never corrupt the stored table
// (each measurement falls back to its current value, never to garbage).
function sanitizeSizeGuide(payload, current) {
  const next = {};
  for (const type of SIZE_GUIDE_GARMENT_TYPES) {
    const currentTable = current[type] || DEFAULT_MEASUREMENTS();
    const incomingTable = payload?.[type];
    next[type] = {};
    for (const size of SIZE_GUIDE_SIZES) {
      const currentRow = currentTable[size] || DEFAULT_MEASUREMENTS()[size];
      const incomingRow = incomingTable?.[size];
      next[type][size] = {
        chest: sanitizeMeasurement(incomingRow?.chest, currentRow.chest),
        length: sanitizeMeasurement(incomingRow?.length, currentRow.length),
        sleeve: sanitizeMeasurement(incomingRow?.sleeve, currentRow.sleeve),
      };
    }
  }
  return next;
}

export async function updateSiteContentSection(section, payload = {}) {
  const key = clean(section, 60);
  if (!SECTIONS.includes(key)) {
    return { status: 404, body: { error: `Unknown content section "${key}".` } };
  }

  const existing = await get('SELECT data FROM site_content WHERE section = ?', [key]);
  const current = { ...DEFAULTS[key], ...(existing ? fromJson(existing.data, {}) : {}) };

  if (key === 'sizeGuide') {
    const next = sanitizeSizeGuide(payload, current);
    await run(
      `INSERT INTO site_content (section, data, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON DUPLICATE KEY UPDATE data = VALUES(data), updatedAt = VALUES(updatedAt)`,
      [key, toJson(next)]
    );
    return { status: 200, body: { section: key, content: next } };
  }

  const next = { ...current };
  for (const field of Object.keys(DEFAULTS[key])) {
    if (payload[field] === undefined) continue;
    const defaultValue = DEFAULTS[key][field];
    if (typeof defaultValue === 'boolean') {
      next[field] = Boolean(payload[field]);
    } else if (Array.isArray(defaultValue)) {
      next[field] = Array.isArray(payload[field])
        ? payload[field]
          .slice(0, 24)
          .map((item, i) => ({
            id: clean(item?.id || `img_${Date.now()}_${i}`, 40),
            url: cleanUrlField(item?.url, 2000),
            link: cleanUrlField(item?.link, 2000),
          }))
          .filter((item) => item.url)
        : defaultValue;
    } else if (isUrlField(field)) {
      next[field] = cleanUrlField(payload[field], 2000);
    } else if (ENUM_FIELDS[field]) {
      next[field] = ENUM_FIELDS[field].has(payload[field]) ? payload[field] : current[field];
    } else {
      next[field] = clean(payload[field], 4000);
    }
  }

  await run(
    `INSERT INTO site_content (section, data, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE data = VALUES(data), updatedAt = VALUES(updatedAt)`,
    [key, toJson(next)]
  );

  return { status: 200, body: { section: key, content: next } };
}
