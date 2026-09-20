import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { translate, translateDocument } from '../i18n/translations';
import { RATES } from '../data/currency';

const AppContext = createContext(null);
const read = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

// Mirrors server/content-api.mjs's DEFAULT_MEASUREMENTS() exactly (today's
// real size-guide numbers) — used only as the pre-fetch/offline fallback.
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

// Mirrors server/content-api.mjs DEFAULTS so editable sections (hero, banners,
// about story, announcement bar) render sane copy before the /api/content
// fetch resolves, or if the API is unreachable (e.g. a static preview).
const DEFAULT_CONTENT = {
  announcement: {
    enabled: true,
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
    mobileImageUrl: '',
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
  brandPhilosophy: {
    headline: 'Character Is Built.',
    subline: 'Built from chaos. Made for progress. Worn by individuals.',
  },
  shopMenuVideo: {
    videoUrl: '',
    posterUrl: '',
  },
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
  collection001: {
    heroEnabled: true,
    heroLabel: 'Urban Phoenix',
    heroHeadline: 'Collection\n001',
    heroSub: 'Freedom To Become. Our debut collection is a declaration — three pieces built for those who choose evolution over comfort.',
    heroCtaLabel: 'Shop All Pieces',
    heroCtaDestination: 'shop',
    heroImageUrl: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=1920&h=1080&fit=crop&auto=format&q=85',
    heroImageAlt: 'Collection 001 campaign hero photo',
    heroMobileImageUrl: '',
    storyEnabled: true,
    storyEyebrow: 'The Story',
    storyHeadline: 'Freedom\nTo\nBecome.',
    storyBody: 'Our first collection begins with one question: who do you want to become?\n\nNot who you were supposed to be. Not who people already know you as. Not who your past says you are.\n\nWho do you choose to become?\n\nFreedom To Become is about the space between who you were and who you are building.\n\nThe weight of what was. The uncertainty of what comes next. And the freedom to decide anyway.',
    productsEnabled: true,
    productsEyebrow: 'Shop The Collection',
    productsHeadingMode: 'dynamic',
    productsHeadingCustom: '',
    seoTitle: 'Collection 001 — Urban Phoenix',
    seoDescription: 'Freedom To Become. Urban Phoenix Collection 001 — three pieces built for those who choose evolution over comfort.',
    seoImage: '',
  },
  collection002: {
    enabled: true,
    eyebrow: 'Collection 002',
    headline: 'Coming\nSoon',
    imageUrl: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=1920&h=700&fit=crop&auto=format&q=85',
    imageAlt: 'Collection 002 campaign photo',
    mobileImageUrl: '',
    ctaEnabled: false,
    ctaLabel: '',
    ctaDestination: 'shop',
    status: 'coming_soon',
  },
  footer: {
    tagline: 'Built from chaos. Built for the few. Collection 001 — Freedom To Become.',
    copyrightName: 'Urban Phoenix',
  },
  socialLinks: {
    instagram: 'https://www.instagram.com/urbanphoenixofficial/',
    tiktok: 'https://www.tiktok.com/@karenzadelyan328',
    twitter: 'https://x.com/urbanphoenix_',
  },
  shippingInfo: {
    intro: 'Urban Phoenix ships from Armenia to Armenia and the United States. Delivery estimates begin after an order has been processed and dispatched.',
  },
  sizeGuide: {
    tshirt: DEFAULT_MEASUREMENTS(), hoodie: DEFAULT_MEASUREMENTS(), sweatshirt: DEFAULT_MEASUREMENTS(), longsleeve: DEFAULT_MEASUREMENTS(),
  },
};

const PAGE_TITLES = {
  home: 'Urban Phoenix — Freedom To Become',
  shop: 'Shop All — Urban Phoenix',
  collection: 'Collection 001 — Urban Phoenix',
  about: 'About — Urban Phoenix',
  cart: 'Your Bag — Urban Phoenix',
  wishlist: 'Wishlist — Urban Phoenix',
  search: 'Search — Urban Phoenix',
  login: 'Sign In — Urban Phoenix',
  'reset-password': 'Reset Password — Urban Phoenix',
  account: 'My Account — Urban Phoenix',
  checkout: 'Checkout — Urban Phoenix',
  track: 'Track Your Order — Urban Phoenix',
  contact: 'Contact — Urban Phoenix',
  journal: 'Journal — Urban Phoenix',
  drop: 'New Drop — Urban Phoenix',
  'gift-cards': 'Buy a Gift Card — Urban Phoenix',
};

// Path <-> page-state mapping, kept intentionally simple so every existing
// navigate(page, data) call site keeps working untouched: this just mirrors
// whatever page state is active into the URL (and reads it back on load/back-forward),
// so refreshing, sharing a link, or using the browser back button no longer dumps
// the visitor back to the homepage.
export function pageToPath(page, data, selectedProduct) {
  if (page === 'home') return '/';
  if (page === 'product') {
    const id = data?.product?.id || data?.id || selectedProduct?.id;
    return id ? `/product/${encodeURIComponent(id)}` : '/shop';
  }
  if (page === 'journal-post') {
    const slug = data?.slug;
    return slug ? `/journal/${encodeURIComponent(slug)}` : '/journal';
  }
  return `/${page}`;
}

function pathToPageInfo(pathname) {
  const clean = pathname.replace(/\/+$/, '') || '/';
  if (clean === '/') return { page: 'home' };
  const productMatch = clean.match(/^\/product\/([^/]+)$/);
  if (productMatch) return { page: 'product', productId: decodeURIComponent(productMatch[1]) };
  const journalMatch = clean.match(/^\/journal\/([^/]+)$/);
  if (journalMatch) return { page: 'journal-post', slug: decodeURIComponent(journalMatch[1]) };
  return { page: clean.slice(1) };
}

function setMetaTag(name, property, content) {
  const selector = property ? `meta[property="${property}"]` : `meta[name="${name}"]`;
  let tag = document.querySelector(selector);
  if (!tag) {
    tag = document.createElement('meta');
    if (property) tag.setAttribute('property', property); else tag.setAttribute('name', name);
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function setCanonicalLink(path) {
  let tag = document.querySelector('link[rel="canonical"]');
  if (!tag) {
    tag = document.createElement('link');
    tag.setAttribute('rel', 'canonical');
    document.head.appendChild(tag);
  }
  tag.setAttribute('href', `${window.location.origin}${path}`);
}

// Writes/replaces a <script type="application/ld+json"> tag identified by id.
// Passing data=null removes it (e.g. Product schema only applies on product pages).
function setJsonLd(id, data) {
  const existing = document.getElementById(id);
  if (!data) {
    existing?.remove();
    return;
  }
  let tag = existing;
  if (!tag) {
    tag = document.createElement('script');
    tag.type = 'application/ld+json';
    tag.id = id;
    document.head.appendChild(tag);
  }
  tag.textContent = JSON.stringify(data);
}

const PAGE_LABELS = {
  home: 'Home', shop: 'Shop', collection: 'Collections', about: 'About', cart: 'Bag',
  wishlist: 'Wishlist', search: 'Search', login: 'Sign In', account: 'Account',
  checkout: 'Checkout', track: 'Track Order', contact: 'Contact',
};

function buildBreadcrumbs(page, product) {
  const origin = window.location.origin;
  const items = [{ name: 'Home', path: '/' }];
  if (page === 'product' && product) {
    items.push({ name: 'Shop', path: '/shop' });
    items.push({ name: product.name, path: pageToPath('product', {}, product) });
  } else if (page !== 'home') {
    items.push({ name: PAGE_LABELS[page] || page, path: pageToPath(page) });
  }
  if (items.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: `${origin}${item.path}`,
    })),
  };
}

function buildProductSchema(product, origin) {
  if (!product) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description || undefined,
    image: product.images || undefined,
    sku: product.id,
    brand: { '@type': 'Brand', name: 'Urban Phoenix' },
    offers: {
      '@type': 'Offer',
      url: `${origin}${pageToPath('product', {}, product)}`,
      priceCurrency: 'USD',
      price: product.price,
      availability: product.isSoldOut
        ? 'https://schema.org/OutOfStock'
        : 'https://schema.org/InStock',
    },
  };
}

// Product pages otherwise all shared the generic "Urban Phoenix" title/description
// (invisible to search results and social previews) — give each product its own,
// plus JSON-LD structured data (Product + BreadcrumbList) so eligible pages are
// candidates for rich results in search.
function setDocumentMeta(page, product, content) {
  // Collection 001's own SEO fields (Admin → Site Content → Collections →
  // Collection 001 → 05 SEO) — the only page with CMS-managed SEO today;
  // every other page keeps its fixed PAGE_TITLES entry. `content` is
  // optional (the very first mount-time call fires before the CMS fetch
  // resolves) — DEFAULT_CONTENT.collection001 above covers that case.
  const collectionSeo = content?.collection001;
  const title = page === 'product' && product
    ? `${product.name} — Urban Phoenix`
    : page === 'collection' && collectionSeo?.seoTitle
      ? collectionSeo.seoTitle
      : (PAGE_TITLES[page] || 'Urban Phoenix');
  const description = page === 'product' && product
    ? (product.description || '').slice(0, 155)
    : page === 'collection' && collectionSeo?.seoDescription
      ? collectionSeo.seoDescription
      : 'Urban Phoenix — streetwear built for those who refuse to stay who they were. Heavyweight tees, hoodies, and outerwear from Collection 001.';
  document.title = title;
  setMetaTag('description', null, description);
  setMetaTag(null, 'og:title', title);
  setMetaTag(null, 'og:description', description);
  if (page === 'product' && product?.images?.[0]) setMetaTag(null, 'og:image', product.images[0]);
  else if (page === 'collection' && (collectionSeo?.seoImage || collectionSeo?.heroImageUrl)) setMetaTag(null, 'og:image', collectionSeo.seoImage || collectionSeo.heroImageUrl);
  setCanonicalLink(pageToPath(page, {}, product));
  setJsonLd('ld-product', page === 'product' ? buildProductSchema(product, window.location.origin) : null);
  setJsonLd('ld-breadcrumbs', buildBreadcrumbs(page, page === 'product' ? product : null));
}

function setOrganizationSchema() {
  setJsonLd('ld-organization', {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'Urban Phoenix',
    url: window.location.origin,
    sameAs: [],
  });
  setJsonLd('ld-website', {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Urban Phoenix',
    url: window.location.origin,
  });
}

// The inline script in index.html already resolved and applied the theme
// (saved choice -> system preference -> dark default) to <html data-theme>
// before React ever mounted, so this just reads that resolved value back
// instead of re-running the same detection and risking a mismatch.
function getInitialTheme() {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function AppProvider({ children }) {
  const initialRoute = typeof window !== 'undefined' ? pathToPageInfo(window.location.pathname) : { page: 'home' };
  const [page, setPage] = useState(initialRoute.page || 'home');
  // Route params parsed straight from the URL (e.g. journal-post's `slug`)
  // must seed pageData on first render — otherwise a hard load/refresh of
  // a route that reads pageData instead of `selectedProduct` (which product
  // routes get initialized separately, below) has nothing to read until a
  // client-side navigate() call happens, which never occurs on a direct load.
  const [pageData, setPageData] = useState(() => {
    const { page: _page, ...rest } = initialRoute;
    return rest;
  });
  // The database/API is the ONLY source of truth for the storefront catalog —
  // never a bundled static/demo list. Starting empty (not pre-seeded with
  // fake products) means there is genuinely nothing to show until the real
  // fetch below resolves; productsStatus is what lets every page distinguish
  // "still loading" from "loaded, and it's genuinely empty" from "failed",
  // instead of collapsing all three into the same empty array.
  const [products, setProducts] = useState([]);
  const [productsStatus, setProductsStatus] = useState('loading'); // 'loading' | 'success' | 'error'
  // Captured once, at mount, from whatever product id (if any) the URL
  // itself named — this is what a hard refresh/direct-load on a product
  // route resolves against once real data arrives (see the effect below).
  // It is NEVER used to guess/render a product before that real data exists.
  const [initialProductId] = useState(() => initialRoute.productId || null);
  // Never pre-seeded from static data — a product page has nothing real to
  // show until the API responds, so this starts null and Routes (App.jsx)
  // renders a loading state for page 'product' while productsStatus is
  // 'loading', instead of ever flashing a wrong/fake product or a premature
  // 404.
  const [selectedProduct, setSelectedProduct] = useState(null);

  const [content, setContent] = useState(DEFAULT_CONTENT);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/content')
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load content'))))
      .then(data => {
        if (!cancelled && data?.content) {
          setContent(prev => ({ ...prev, ...data.content }));
        }
      })
      .catch(() => {
        // Keep the bundled default copy if the API is unreachable.
      });
    return () => { cancelled = true; };
  }, []);
  // Same staleness gap as the products catalog below (fetched once at
  // mount only) — an admin editing the homepage hero/banner/announcement
  // bar in Site Content while a shopper already has the site open wouldn't
  // show up until a hard reload. Revalidate on focus/visibility for the
  // same reason.
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'hidden') return;
      fetch('/api/content')
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error('Failed to load content'))))
        .then((data) => {
          if (data?.content) setContent((prev) => ({ ...prev, ...data.content }));
        })
        .catch(() => {});
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
  }, []);
  const [theme, setThemeState] = useState(getInitialTheme);
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
    localStorage.setItem('up_theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#FAF6EF' : '#0A0A0A');
  }, [theme]);
  // Only follow live OS theme changes for a visitor who has never made an
  // explicit choice — once they pick Light or Dark (via setTheme below),
  // that choice must stick even if their system theme later changes.
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handleSystemChange = (event) => {
      if (localStorage.getItem('up_theme')) return;
      setThemeState(event.matches ? 'light' : 'dark');
    };
    mq.addEventListener('change', handleSystemChange);
    return () => mq.removeEventListener('change', handleSystemChange);
  }, []);
  const setTheme = (value) => setThemeState(value === 'light' ? 'light' : 'dark');
  const toggleTheme = () => setThemeState((prev) => (prev === 'light' ? 'dark' : 'light'));

  const [cart, setCart] = useState(() => read('up_cart', []));
  const [wishlist, setWishlist] = useState(() => read('up_wishlist', []));
  const [recentlyViewed, setRecentlyViewed] = useState(() => read('up_recently_viewed', []));
  useEffect(() => localStorage.setItem('up_recently_viewed', JSON.stringify(recentlyViewed)), [recentlyViewed]);
  // Most-recent-first, deduped, capped — called from ProductPage whenever a
  // product is actually viewed (not on every render, see its product.id effect).
  const trackProductView = (productId) => {
    if (!productId) return;
    setRecentlyViewed((prev) => [productId, ...prev.filter((id) => id !== productId)].slice(0, 12));
  };
  const [user, setUser] = useState(() => read('up_user', null));
  const accountFetch = (path, options = {}) => fetch(`/api/account${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user?.sessionToken}`, ...(options.headers || {}) },
  });

  // Single real fetch path — the initial load (below) and retryLoadProducts
  // (exposed to the UI for an explicit "try again" after an error) both call
  // this, so there is exactly one place that decides what counts as
  // loading/success/empty/error. An empty array is a completely valid,
  // real "success" (the catalog genuinely has nothing to show right now) —
  // it is never treated the same as a request failure.
  const loadProducts = ({ background = false, isCancelled = () => false } = {}) => {
    if (!background) setProductsStatus('loading');
    return fetch('/api/products', {
      headers: user?.sessionToken ? { Authorization: `Bearer ${user.sessionToken}` } : {},
    })
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('Failed to load products'))))
      .then(data => {
        if (isCancelled()) return;
        const list = Array.isArray(data?.products) ? data.products : [];
        setProducts(list);
        setProductsStatus('success');
      })
      .catch(() => {
        if (isCancelled()) return;
        // A background revalidation (tab refocus) failing must not blank out
        // or error-out a catalog that already loaded successfully — only the
        // real initial load (and an explicit retry) can transition to
        // 'error', matching "keep whatever's already loaded" for the quiet
        // background case.
        if (!background) setProductsStatus('error');
      });
  };
  const retryLoadProducts = () => loadProducts({ background: false });

  useEffect(() => {
    let cancelled = false;
    // Re-fetches on login/logout too — early-access and members-only drops
    // are filtered server-side by login state, so signing in should reveal
    // them without a full page reload. Not `background` — a real
    // (re)fetch triggered by an identity change deserves its own honest
    // loading/error state, not a silent one.
    loadProducts({ isCancelled: () => cancelled });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sessionToken]);

  // The catalog above only loads once per page load (plus on login/logout) —
  // a shopper who leaves the tab open (or an admin who edits a product in
  // another tab, e.g. changing its price, then switches back) would keep
  // seeing whatever was fetched at mount until a hard reload. Re-fetching
  // whenever the tab regains focus/visibility closes that gap without
  // polling — the same pattern data-fetching libraries like SWR/React Query
  // default to for "revalidate on focus".
  useEffect(() => {
    const revalidate = () => {
      if (document.visibilityState === 'hidden') return;
      loadProducts({ background: true });
    };
    window.addEventListener('focus', revalidate);
    document.addEventListener('visibilitychange', revalidate);
    return () => {
      window.removeEventListener('focus', revalidate);
      document.removeEventListener('visibilitychange', revalidate);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sessionToken]);

  useEffect(() => {
    if (!user?.sessionToken) return;
    let cancelled = false;
    // Merge whatever was in the local guest wishlist into the account, then treat the
    // server as the source of truth from here on.
    accountFetch('/wishlist/merge', { method: 'POST', body: JSON.stringify({ productIds: wishlist }) })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => { if (!cancelled && Array.isArray(data.productIds)) setWishlist(data.productIds); })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.sessionToken]);
  const normalizeLanguage = value => {
    const normalized = String(value || '').toLowerCase();
    return ['en', 'hy', 'ru'].includes(normalized) ? normalized : 'en';
  };
  const [language, setLanguageState] = useState(() => normalizeLanguage(localStorage.getItem('up_language')));
  const setLanguage = value => setLanguageState(normalizeLanguage(value));
  const [currency, setCurrency] = useState(() => localStorage.getItem('up_currency') || 'USD');
  useEffect(() => {
    if (!user?.sessionToken) return;
    accountFetch('/preferences', { method: 'PUT', body: JSON.stringify({ language, currency }) }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, currency, user?.sessionToken]);
  const [cartOpen, setCartOpen] = useState(false);
  // Cached with a timestamp (not just the bare code) and expired after a day —
  // ipapi.co is rate-limited more often than not in practice, which pushes
  // detection onto a much weaker locale/timezone guess; without an expiry, a
  // single bad guess (e.g. an en-US browser locale outside the US) would
  // stick in localStorage forever and permanently show/hide the free-shipping
  // banner for the wrong region.
  const VISITOR_COUNTRY_TTL_MS = 24 * 60 * 60 * 1000;
  const readCachedVisitorCountry = () => {
    try {
      const raw = JSON.parse(localStorage.getItem('up_visitor_country_v2') || 'null');
      if (raw?.code && Date.now() - raw.ts < VISITOR_COUNTRY_TTL_MS) return raw.code;
    } catch {
      // fall through to the legacy plain-string key below
    }
    return localStorage.getItem('up_visitor_country') || '';
  };
  const [visitorCountry, setVisitorCountryState] = useState(readCachedVisitorCountry);
  const [locationReady, setLocationReady] = useState(Boolean(readCachedVisitorCountry()));
  const setVisitorCountry = (code) => {
    setVisitorCountryState(code);
    localStorage.setItem('up_visitor_country_v2', JSON.stringify({ code, ts: Date.now() }));
    localStorage.removeItem('up_visitor_country');
  };
  // Explicit choice from the region-select popup, distinct from the IP-based
  // guess above — once a visitor has manually picked a country the popup
  // must never reappear on later visits, even if the IP guess later changes.
  const [regionChosen, setRegionChosen] = useState(() => localStorage.getItem('up_region_chosen') === '1');
  const selectRegion = (code) => {
    setVisitorCountry(code);
    if (code === 'US') setCurrency('USD');
    localStorage.setItem('up_region_chosen', '1');
    setRegionChosen(true);
    setLocationReady(true);
  };

  useEffect(() => localStorage.setItem('up_cart', JSON.stringify(cart)), [cart]);
  useEffect(() => localStorage.setItem('up_wishlist', JSON.stringify(wishlist)), [wishlist]);
  useEffect(() => localStorage.setItem('up_user', JSON.stringify(user)), [user]);
  useEffect(() => {
    localStorage.setItem('up_language', language);
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';

    const translateNow = () => translateDocument(language);
    const frame = window.requestAnimationFrame(translateNow);
    const observer = new MutationObserver(() => {
      window.requestAnimationFrame(translateNow);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title'],
    });

    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [language, page, cartOpen]);
  useEffect(() => localStorage.setItem('up_currency', currency), [currency]);

  useEffect(() => {
    if (visitorCountry) return;
    let cancelled = false;

    const detectCountry = async () => {
      try {
        const response = await fetch('https://ipapi.co/json/', { headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('Location request failed');
        const data = await response.json();
        if (!cancelled && data?.country_code) {
          const code = String(data.country_code).toUpperCase();
          setVisitorCountry(code);
          if (code === 'US') setCurrency('USD');
          return;
        }
      } catch {
        // ipapi.co failed or was rate-limited — fall back to a conservative
        // guess. Both signals must agree before assuming US, since a mistaken
        // 'US' incorrectly hides Armenia's flat shipping rate and shows the
        // US $150 free-shipping progress bar to someone it doesn't apply to;
        // wrongly guessing non-US only costs a slightly less tailored banner.
        const localeLooksAmerican = /^en-US\b/i.test(navigator.language || '');
        const timezoneLooksAmerican = /^America\//.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
        const fallback = localeLooksAmerican && timezoneLooksAmerican ? 'US' : 'OTHER';
        if (!cancelled) {
          setVisitorCountry(fallback);
          if (fallback === 'US') setCurrency('USD');
        }
      } finally {
        if (!cancelled) setLocationReady(true);
      }
    };

    detectCountry();
    return () => { cancelled = true; };
  }, [visitorCountry, setCurrency]);

  const navigate = (nextPage, data = {}, options = {}) => {
    let nextSelectedProduct = selectedProduct;
    if (data?.id && data?.name) { nextSelectedProduct = data; data = { product: data }; }
    if (data?.product) nextSelectedProduct = data.product;
    if (data?.id) {
      const found = products.find(product => product.id === data.id);
      if (found) nextSelectedProduct = found;
    }
    if (nextSelectedProduct !== selectedProduct) setSelectedProduct(nextSelectedProduct);
    setPageData(data || {});
    setPage(nextPage);
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (typeof window !== 'undefined' && !options.skipHistory) {
      const path = pageToPath(nextPage, data, nextSelectedProduct);
      if (path !== window.location.pathname) {
        window.history.pushState({ page: nextPage }, '', path);
      }
      setDocumentMeta(nextPage, nextSelectedProduct, content);
    }
  };

  // Keep browser back/forward in sync with in-app page state.
  useEffect(() => {
    const handlePopState = () => {
      const info = pathToPageInfo(window.location.pathname);
      let resolvedProduct = selectedProduct;
      if (info.page === 'product' && info.productId) {
        const found = products.find(product => product.id === info.productId);
        // Navigating (back/forward) to a bad/stale product id must clear the
        // stale selection, not silently keep showing whatever product was
        // previously on screen — same fallback bug as the initial-load case.
        resolvedProduct = found || null;
        setSelectedProduct(resolvedProduct);
      }
      const { page: _page, ...rest } = info;
      setPageData(rest);
      setPage(info.page || 'home');
      setDocumentMeta(info.page || 'home', resolvedProduct, content);
      window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  // The ONLY place a product page's data ever comes from is this real
  // `products` array (fetched from /api/products — see loadProducts above).
  // Runs whenever that array changes: resolves a product page's data for the
  // first time once the initial fetch finishes (matching against
  // initialProductId, captured from the URL at mount, or the current
  // route's id if the user navigated here via the browser's back/forward
  // while products hadn't loaded yet — see popstate, above), and keeps it in
  // sync afterward (e.g. a background revalidation changing that product's
  // price/stock). If products has genuinely finished loading (productsStatus
  // isn't 'loading') and no match exists, selectedProduct is cleared to
  // null — a real 404, never a stale/fake product left on screen.
  useEffect(() => {
    if (page !== 'product') return;
    const currentPathProductId = pathToPageInfo(window.location.pathname).productId;
    const idToResolve = selectedProduct?.id || currentPathProductId || initialProductId;
    if (!idToResolve) return;
    const found = products.find(p => p.id === idToResolve);
    if (found) {
      if (found !== selectedProduct) { setSelectedProduct(found); setDocumentMeta('product', found, content); }
    } else if (selectedProduct && productsStatus !== 'loading') {
      setSelectedProduct(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, productsStatus]);

  const addToCart = item => {
    const safeItem = { ...item, quantity: Math.min(100, Math.max(1, Number(item.quantity) || 1)) };
    setCart(prev => {
      const match = prev.find(x => x.product.id === safeItem.product.id && x.size === safeItem.size && x.color === safeItem.color && JSON.stringify(x.editionNumbers || []) === JSON.stringify(safeItem.editionNumbers || []));
      return match
        ? prev.map(x => x === match ? { ...x, quantity: Math.min(100, x.quantity + safeItem.quantity) } : x)
        : [...prev, safeItem];
    });
    setCartOpen(true);
  };
  // A cart line's real identity is product + size + color + serial numbers —
  // NOT just product + size. Two Limited Edition pieces of the same product/
  // size/color but different serials (e.g. 037/100 and 041/100) are two
  // distinct cart lines (see addToCart's own match check above), so any
  // lookup that only compares product/size/color would silently act on both
  // at once — removing or requantifying one would also touch the other.
  // editionNumbers is compared by value (order-independent would be nicer,
  // but addToCart always stores it pre-sorted, so JSON equality is exact and
  // cheap); color keeps its historical "omitted = match any color" escape
  // hatch for callers that only ever have one color to worry about, but
  // every real call site in this codebase now passes the item's actual
  // color and editionNumbers.
  const sameCartLine = (item, productId, size, color, editionNumbers) => (
    item.product.id === productId
    && item.size === size
    && (color === undefined || item.color === color)
    && JSON.stringify(item.editionNumbers || []) === JSON.stringify(editionNumbers || [])
  );
  const removeFromCart = (productId, size, color, editionNumbers) => setCart(prev => prev.filter(x => !sameCartLine(x, productId, size, color, editionNumbers)));
  const updateQuantity = (productId, size, colorOrQuantity, maybeQuantity, editionNumbers) => {
    const hasColor = maybeQuantity !== undefined;
    const color = hasColor ? colorOrQuantity : undefined;
    const quantity = hasColor ? maybeQuantity : colorOrQuantity;
    if (quantity <= 0) return removeFromCart(productId, size, color, editionNumbers);
    const safeQuantity = Math.min(100, Math.max(1, Number(quantity) || 1));
    setCart(prev => prev.map(x => (sameCartLine(x, productId, size, color, editionNumbers) ? { ...x, quantity: safeQuantity } : x)));
  };
  const toggleWishlist = (id) => {
    const currentlyIn = wishlist.includes(id);
    setWishlist((prev) => (currentlyIn ? prev.filter((x) => x !== id) : [...prev, id]));
    if (!user?.sessionToken) return;
    const request = currentlyIn
      ? accountFetch(`/wishlist/${encodeURIComponent(id)}`, { method: 'DELETE' })
      : accountFetch('/wishlist', { method: 'POST', body: JSON.stringify({ productId: id }) });
    request
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => { if (Array.isArray(data.productIds)) setWishlist(data.productIds); })
      .catch(() => {}); // local state already updated optimistically
  };
  const isWishlisted = id => wishlist.includes(id);
  const isUnitedStates = visitorCountry === 'US';
  const regionalPriceMultiplier = isUnitedStates ? 1.15 : 1;
  const getRegionalPrice = value => Number(value || 0) * regionalPriceMultiplier;
  const cartTotal = useMemo(
    () => cart.reduce((sum, x) => sum + getRegionalPrice(x.product.price) * x.quantity, 0),
    [cart, regionalPriceMultiplier],
  );
  const cartCount = useMemo(() => cart.reduce((sum, x) => sum + x.quantity, 0), [cart]);

  // Applied promo code lives here (not in Cart/Checkout page state) so it
  // survives navigating from Cart to Checkout instead of silently vanishing.
  // Only the code/type/value are persisted — the discount amount is always
  // recomputed from the live cart total, mirroring the server's own
  // computeDiscount() logic, so it never goes stale as the cart changes.
  const [promo, setPromo] = useState(() => read('up_promo', null));
  useEffect(() => localStorage.setItem('up_promo', JSON.stringify(promo)), [promo]);
  const applyPromoCode = async (code) => {
    const trimmed = String(code || '').trim();
    if (!trimmed) return { ok: false, error: 'Enter a promo code.' };
    try {
      const response = await fetch('/api/promo/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed, subtotal: cartTotal }),
      });
      const data = await response.json();
      if (!response.ok || !data.valid) throw new Error(data.error || 'This promo code is not valid.');
      setPromo({ code: data.code, type: data.type, value: data.value });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'This promo code is not valid.' };
    }
  };
  const removePromoCode = () => setPromo(null);
  const discountAmount = useMemo(() => {
    if (!promo) return 0;
    if (promo.type === 'fixed') return Math.min(promo.value, cartTotal);
    const pct = Math.min(100, Math.max(0, promo.value));
    return Number(((cartTotal * pct) / 100).toFixed(2));
  }, [promo, cartTotal]);

  // Gift card balance is applied after the promo discount, capped by the
  // remaining order total — mirrors the server's validateOrderDraft() math
  // so the checkout preview never disagrees with what actually gets charged.
  const [giftCard, setGiftCard] = useState(() => read('up_giftcard', null));
  useEffect(() => localStorage.setItem('up_giftcard', JSON.stringify(giftCard)), [giftCard]);
  const applyGiftCard = async (code) => {
    const trimmed = String(code || '').trim();
    if (!trimmed) return { ok: false, error: 'Enter a gift card code.' };
    try {
      const response = await fetch('/api/gift-cards/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await response.json();
      if (!response.ok || !data.valid) throw new Error(data.error || 'This gift card code is not valid.');
      // balance/currency are the card's own native units (for display —
      // "AMD 40,000 applied"); balanceUsd is the server-converted amount
      // checkout math actually uses, since orders are always USD-
      // denominated internally regardless of the card's purchase currency.
      setGiftCard({ code: data.code, balance: data.balance, currency: data.currency, balanceUsd: data.balanceUsd });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message || 'This gift card code is not valid.' };
    }
  };
  const removeGiftCard = () => setGiftCard(null);
  const giftCardAmount = useMemo(() => {
    if (!giftCard) return 0;
    const preGiftCardTotal = Math.max(0, cartTotal - discountAmount);
    const balanceUsd = giftCard.balanceUsd ?? giftCard.balance; // back-compat for a card applied before this field existed
    return Number(Math.min(balanceUsd, preGiftCardTotal).toFixed(2));
  }, [giftCard, cartTotal, discountAmount]);

  const formatMoney = (value, options = {}) => {
    const adjusted = options.regional === false ? Number(value || 0) : getRegionalPrice(value);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'AMD' ? 0 : 2,
    }).format(adjusted * RATES[currency]);
  };
  const t = text => translate(language, text);
  const login = async ({ email, password }) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Invalid email or password.');
      err.needsVerification = Boolean(data.needsVerification);
      throw err;
    }
    setUser({ ...data.user, sessionToken: data.token });
    fetch('/api/account/preferences', { headers: { Authorization: `Bearer ${data.token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((prefs) => {
        if (prefs?.preferences?.language) setLanguage(prefs.preferences.language);
        if (prefs?.preferences?.currency) setCurrency(prefs.preferences.currency);
      })
      .catch(() => {});
    return data.user;
  };
  const register = async (payload) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create your account.');
    return data; // { message, emailSent, devVerificationLink? } — caller shows a "check your email" screen
  };
  const resendVerification = async (email) => {
    const res = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not resend the verification email.');
    return data;
  };
  const verifyCode = async (email, code) => {
    const res = await fetch('/api/auth/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invalid code.');
    setUser({ ...data.user, sessionToken: data.token });
    return data.user;
  };
  const requestPasswordReset = async (email) => {
    const res = await fetch('/api/auth/request-password-reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not send the reset email.');
    return data; // { message, emailSent, devResetLink? }
  };
  const resetPassword = async ({ email, token, password }) => {
    const res = await fetch('/api/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, token, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not reset your password.');
    setUser({ ...data.user, sessionToken: data.token });
    return data.user;
  };
  const logout = () => setUser(null);
  const refreshUser = (patch) => setUser((prev) => (prev ? { ...prev, ...patch } : prev));

  useEffect(() => {
    setOrganizationSchema();
    setDocumentMeta(page, selectedProduct, content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [emailVerificationStatus, setEmailVerificationStatus] = useState(null);
  const dismissEmailVerificationStatus = () => setEmailVerificationStatus(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('emailVerification');
    if (status) {
      setEmailVerificationStatus(status);
      params.delete('emailVerification');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    }
  }, []);

  return <AppContext.Provider value={{page,pageData,navigate,products,productsStatus,retryLoadProducts,selectedProduct,content,socialLinks:content.socialLinks,cart,addToCart,removeFromCart,updateQuantity,cartTotal,cartCount,cartOpen,setCartOpen,promo,discountAmount,applyPromoCode,removePromoCode,giftCard,giftCardAmount,applyGiftCard,removeGiftCard,wishlist,toggleWishlist,isWishlisted,recentlyViewed,trackProductView,user,login,register,resendVerification,verifyCode,requestPasswordReset,resetPassword,logout,refreshUser,accountFetch,emailVerificationStatus,dismissEmailVerificationStatus,language,setLanguage,currency,setCurrency,formatMoney,getRegionalPrice,visitorCountry,isUnitedStates,regionalPriceMultiplier,locationReady,regionChosen,selectRegion,t,theme,setTheme,toggleTheme,clearCart:()=>{setCart([]);setPromo(null);setGiftCard(null);}}}>{children}</AppContext.Provider>;
}
export function useApp(){ const value=useContext(AppContext); if(!value) throw new Error('useApp must be used inside AppProvider'); return value; }
