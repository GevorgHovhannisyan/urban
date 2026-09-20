import { useEffect, useRef, useState } from 'react';
import { useApp, pageToPath } from '../context/AppContext';
import AnnouncementBar from './AnnouncementBar';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { useExitAnimation } from '../hooks/useExitAnimation';
import { ShopMegaMenu, CATEGORIES, CATEGORY_LABELS } from './MegaMenu';
import SearchOverlay from './SearchOverlay';
import ThemeToggle from './ThemeToggle';
import { CURRENCIES } from '../data/currency';

// The single source of truth for the navbar's scroll behavior. Three
// distinct states — never one flag standing in for another:
//   - headerHidden: slid away via transform, real downward scroll only.
//   - headerBlack: solid/black background, real upward scroll only.
//   - "at top" isn't its own stored state — it's just currentY <= TOP_THRESHOLD,
//     checked fresh on every scroll event — and forces both of the above
//     back to their resting values (visible + transparent).
// TOP_THRESHOLD is deliberately small (this is "did the user basically
// return to the very top", not a general hide/show trigger), and
// DELTA_THRESHOLD is the minimum per-frame movement that counts as an
// intentional scroll rather than 1-2px of trackpad/mouse jitter.
const TOP_THRESHOLD = 5;
const DELTA_THRESHOLD = 4;

const languages = [
  { value: 'en', short: 'EN', label: 'English' },
  { value: 'hy', short: 'HY', label: 'Հայերեն' },
  { value: 'ru', short: 'RU', label: 'Русский' },
];

// Reuses the site's single shared currency list (src/data/currency.js —
// also the gift card system's authoritative currency/rate source) rather
// than keeping a second copy here that could drift out of sync.
const currencies = CURRENCIES.map((c) => ({ value: c.code, label: c.label, symbol: c.symbol }));

function ChevronIcon({ open }) {
  return (
    <svg
      width="8" height="8" viewBox="0 0 10 6" fill="none" aria-hidden="true"
      className={`header-select__chevron-icon ${open ? 'is-open' : ''}`}
    >
      <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="10" height="8" viewBox="0 0 12 9" fill="none" aria-hidden="true" className="header-select__check">
      <path d="M1 4.2L4.2 7.4 10.6 1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// selectId/openId/setOpenId are lifted to the parent (rather than local
// open state) so the language and currency selects in the same group can
// enforce "only one open at a time" without reaching into each other.
function HeaderSelect({ selectId, type, value, options, onChange, translateLabel = (label) => label, compact = false, openId, setOpenId }) {
  const rootRef = useRef(null);
  const menuRef = useRef(null);
  const triggerRef = useRef(null);
  const open = openId === selectId;
  const normalizedValue = String(value || '').toLowerCase();
  const selected = options.find((option) =>
    String(option.value).toLowerCase() === normalizedValue
  ) || options[0];

  const closeSelf = () => setOpenId((current) => (current === selectId ? null : current));

  // Outside click, Escape, and roving arrow-key navigation between options —
  // only wired up while this particular menu is open.
  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) closeSelf();
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeSelf();
        triggerRef.current?.focus();
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      const items = Array.from(menuRef.current?.querySelectorAll('[role="option"]') || []);
      if (items.length === 0) return;
      event.preventDefault();
      const currentIndex = items.indexOf(document.activeElement);
      let nextIndex = currentIndex;
      if (event.key === 'ArrowDown') nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
      else if (event.key === 'ArrowUp') nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = items.length - 1;
      items[nextIndex]?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    // Move focus into the menu as soon as it opens, landing on the current
    // selection so arrow keys work immediately without an extra Tab press.
    const activeItem = menuRef.current?.querySelector('[aria-selected="true"]');
    const firstItem = menuRef.current?.querySelector('[role="option"]');
    (activeItem || firstItem)?.focus();

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Tabbing out of the whole control closes it, matching standard
  // listbox-popup keyboard behavior.
  const handleBlur = (event) => {
    if (!rootRef.current?.contains(event.relatedTarget)) closeSelf();
  };

  return (
    <div className={`header-select header-select--${type}`} ref={rootRef} onBlur={handleBlur}>
      <button
        ref={triggerRef}
        type="button"
        className="header-select__trigger"
        onClick={() => setOpenId((current) => (current === selectId ? null : selectId))}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="header-select__symbol">
          {type === 'language' ? selected.short : selected.symbol}
        </span>
        <span className={`header-select__label ${compact ? 'hidden xl:inline' : ''}`}>
          {type === 'language' ? selected.label : selected.value}
        </span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          className="header-select__menu"
          role="listbox"
          ref={menuRef}
          aria-label={type === 'language' ? 'Select language' : 'Select currency'}
        >
          {options.map((option) => {
            const isActive = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={isActive}
                className={`header-select__option ${isActive ? 'is-active' : ''}`}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onChange(option.value);
                  setOpenId(null);
                }}
              >
                <span className="header-select__symbol">
                  {type === 'language' ? option.short : option.symbol}
                </span>
                <span className="header-select__label">
                  {type === 'language' ? option.label : `${option.value} — ${translateLabel(option.label)}`}
                </span>
                {isActive && <CheckIcon />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const {
    page,
    navigate,
    cartCount,
    wishlist,
    cartOpen,
    setCartOpen,
    language,
    setLanguage,
    currency,
    setCurrency,
    user,
    t,
    theme,
  } = useApp();

  // The transparent header only makes sense over a page whose content sits
  // directly behind it — a true full-bleed hero photo/video at y=0 (Home,
  // Collection). Every other page pushes its content below the header with
  // top padding instead, so a "transparent" header there just shows the
  // plain themed page background through it. .up-nav/.up-icon are hardcoded
  // near-white for legibility over a dark hero scrim; against the light
  // theme's cream page background that reads as invisible nav links. A
  // non-hero page is solid from the first paint, always — a hero page's
  // solid/transparent state instead follows headerBlack, which the scroll
  // handler below drives by direction (see its own comment).
  const HERO_PAGES = ['home', 'collection'];
  const isHeroPage = HERO_PAGES.includes(page);
  // headerBlack starts true for a hero page mounted already scrolled past
  // the top (nothing has fired a scroll event yet to set it otherwise) —
  // "transparent" is only ever correct exactly at the top.
  const [headerBlack, setHeaderBlack] = useState(() => typeof window !== 'undefined' && window.scrollY > TOP_THRESHOLD);
  const solidHeader = !isHeroPage || headerBlack;
  // Hide-on-scroll-down / show-on-scroll-up. A small, real downward scroll
  // slides the ENTIRE header (shipping bar + nav, as one unit — applied to
  // site-header-wrap, not the nav alone) up and out via transform (never
  // display/visibility, so it stays a smooth animation); a small real
  // upward scroll brings it right back — see the scroll handler below for
  // how this and headerBlack are set together (never from one shared flag).
  const [headerHidden, setHeaderHidden] = useState(false);
  const [menu, setMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const announceRef = useRef(null);
  const menuRef = useRef(null);
  useDialogBehavior(menu, () => setMenu(false), menuRef);
  // Same reliable exit-animation architecture as Search/Cart — keeps the
  // menu mounted for its own close transition instead of unmounting the
  // instant `menu` goes false.
  const { rendered: menuRendered, closing: menuClosing } = useExitAnimation(menu, 260);

  // Desktop and mobile preference groups each enforce "only one dropdown
  // open at a time" within their own group (they're never visible together).
  const [desktopPrefOpen, setDesktopPrefOpen] = useState(null);
  const [mobilePrefOpen, setMobilePrefOpen] = useState(null);
  // The mobile menu subtree unmounts on close but this state lives in
  // Navbar and would otherwise persist — without this, reopening the mobile
  // menu could render a dropdown already open from the previous visit.
  useEffect(() => {
    if (!menu) setMobilePrefOpen(null);
  }, [menu]);

  useEffect(() => {
    let lastY = window.scrollY;
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const currentY = window.scrollY;
        const delta = currentY - lastY;
        const isAtTop = currentY <= TOP_THRESHOLD;
        if (isAtTop) {
          // Back at the very top — visible and transparent, regardless of
          // whatever direction/state it was in a moment ago.
          setHeaderHidden(false);
          setHeaderBlack(false);
        } else if (delta > DELTA_THRESHOLD) {
          // Real downward scroll — hide. headerBlack is left alone here: it
          // doesn't matter while hidden, and leaving it set means the header
          // reappears already black if the user then scrolls back up, never
          // transparent-then-fading-to-black.
          setHeaderHidden(true);
          // A dropdown left open while the header slides away would end up
          // floating off-screen with it — close any open preference menu
          // the moment the header actually hides (the mega menu already
          // closes itself on scroll; see MegaMenu.jsx).
          setDesktopPrefOpen(null);
        } else if (delta < -DELTA_THRESHOLD) {
          // Real upward scroll — reappear already black, in the same tick
          // (never transparent for even a frame before turning black).
          setHeaderHidden(false);
          setHeaderBlack(true);
        }
        // Anything smaller than DELTA_THRESHOLD in either direction is
        // treated as jitter, not a real scroll — state is simply left alone.
        lastY = currentY;
        ticking = false;
      });
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The announcement bar can be toggled/edited from the admin panel, so its height
  // isn't fixed at build time — measure it and publish both heights as CSS vars.
  // Every page that pads for the fixed header reads --site-header-h instead of a
  // hardcoded 68px, so it stays correct whether the bar is shown or hidden.
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const announceHeight = announceRef.current?.offsetHeight || 0;
      root.style.setProperty('--announce-h', `${announceHeight}px`);
      root.style.setProperty('--site-header-h', `${announceHeight + 68}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    if (announceRef.current) observer.observe(announceRef.current);
    return () => observer.disconnect();
  }, []);

  // "New Drop" only belongs in primary navigation while there's an actual
  // upcoming/early-access piece to show — the same /api/drops feed
  // DropPage.jsx itself renders from (server/products-api.mjs's
  // listDropTeasers, real releaseAt-gated product data), never a static
  // "always on" nav entry.
  const [hasActiveDrop, setHasActiveDrop] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/drops')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setHasActiveDrop(Array.isArray(d.drops) && d.drops.length > 0); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Gift Cards intentionally stays out of primary navigation (still fully
  // reachable via the footer and its own direct route) — see Footer.jsx's
  // Shop group.
  const links = [
    ['Shop', 'shop'],
    ...(hasActiveDrop ? [['New Drop', 'drop']] : []),
    ['Collections', 'collection'],
    ['Journal', 'journal'],
    ['About', 'about'],
  ];

  const go = (page) => (e) => { e.preventDefault(); navigate(page); };

  return (
    <>
      {/* One single wrapper controls all vertical movement — the shipping
          bar and the navbar are its plain, non-positioned children and
          always move together as one header, never independently (see this
          file's own scroll handler + index.css's .site-header-wrap /
          .site-header-wrap--hidden). The navbar's transparent/black
          background is a completely separate concern layered on top of
          that — it only ever changes color, never its own position. */}
      <div className={`site-header-wrap fixed inset-x-0 top-0 z-[60] w-full ${headerHidden ? 'site-header-wrap--hidden' : ''}`}>
        <div ref={announceRef} className="w-full">
          <AnnouncementBar />
        </div>

        <nav className={`site-header w-full h-[68px] ${solidHeader ? 'site-header--solid' : ''}`}>
        <div className="site-header__inner relative max-w-screen-2xl mx-auto h-full px-6 lg:px-6 xl:px-12 flex items-center">
          {/* The logo is absolutely centered in the nav rather than living in
              a 3-column grid/flex split — a 1fr/auto/1fr grid was tried, but
              CSS Grid's `1fr` tracks aren't equal when one side's content is
              hidden (empty on mobile, since the nav-links column is `hidden
              lg:flex`) and the other has real icons: the track with content
              gets a larger auto-minimum before the fr split, so the "equal"
              1fr columns actually differ and the logo skewed toward the
              empty side (visually confirmed off-center at every width below
              lg). Absolute centering is correct regardless of how
              unbalanced the two side clusters are, at any breakpoint. */}
          <div className="hidden lg:flex items-center justify-start gap-2 min-[1150px]:gap-4 xl:gap-8">
            <ShopMegaMenu navigate={navigate} />
            {hasActiveDrop && <a href={pageToPath('drop')} onClick={go('drop')} className="up-nav">{t('New Drop')}</a>}
            <a href={pageToPath('collection')} onClick={go('collection')} className="up-nav">{t('Collections')}</a>
            <a href={pageToPath('journal')} onClick={go('journal')} className="up-nav hidden min-[1150px]:inline-block">{t('Journal')}</a>
            <a href={pageToPath('about')} onClick={go('about')} className="up-nav">{t('About')}</a>
          </div>

          <a href={pageToPath('home')} onClick={go('home')} className="absolute left-1/2 top-1/2 shrink-0" style={{ transform: 'translate(-50%, -50%)' }} aria-label="Urban Phoenix — home">
            {/* Source art is black ink on a solid white backdrop (no alpha
                channel). Over the transparent state (still floating on the
                hero photo, which carries its own dark scrim independent of
                site theme) it always needs to read as white ink: invert()
                flips ink-white/bg-black, then screen blend (the
                light-background opposite of multiply) drops the now-black
                backdrop into whatever's behind the header while keeping the
                now-white ink fully opaque. Once solid, the header background
                itself is theme-driven (near-black in dark, cream in light),
                so a permanently-inverted white mark would go invisible on a
                light header — only invert there when the dark theme is
                active; light theme keeps the original black ink as-is. */}
            <img
              src="/images/brand/up-logo.png"
              alt="Urban Phoenix"
              className="h-9 sm:h-10 w-auto"
              style={
                !solidHeader || theme === 'dark'
                  ? { filter: 'invert(1)', mixBlendMode: 'screen' }
                  : undefined
              }
            />
          </a>

          <div className="flex items-center justify-center gap-2 sm:gap-4 ml-auto">
            <button onClick={() => setSearchOpen(true)} aria-label="Search" className="up-icon hidden sm:inline-flex items-center justify-center">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <circle cx="11" cy="11" r="7.5" />
                <line x1="21" y1="21" x2="16.2" y2="16.2" />
              </svg>
            </button>
            <ThemeToggle />
            <a key={user ? 'account' : 'login'} href={pageToPath(user ? 'account' : 'login')} onClick={go(user ? 'account' : 'login')} className="hidden lg:block up-nav">
              {t(user ? 'Account' : 'Login')}
            </a>
            <a href={pageToPath('wishlist')} onClick={go('wishlist')} aria-label="Wishlist" className="up-icon inline-flex items-center justify-center">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {wishlist.length > 0 && <b key={wishlist.length} className="up-badge up-badge-pop">{wishlist.length}</b>}
            </a>
            <button onClick={() => setCartOpen(!cartOpen)} aria-label="Shopping bag" className="up-icon inline-flex items-center justify-center">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 0 1-8 0" />
              </svg>
              {cartCount > 0 && <b key={cartCount} className="up-badge up-badge-pop">{cartCount}</b>}
            </button>

            <div className="header-preferences hidden lg:flex">
              <HeaderSelect key={`desktop-language-${language}`} selectId="language" type="language" value={language} options={languages} onChange={setLanguage} translateLabel={t} compact openId={desktopPrefOpen} setOpenId={setDesktopPrefOpen} />
              <HeaderSelect key={`desktop-currency-${currency}`} selectId="currency" type="currency" value={currency} options={currencies} onChange={setCurrency} translateLabel={t} compact openId={desktopPrefOpen} setOpenId={setDesktopPrefOpen} />
            </div>

            <button onClick={() => setMenu(!menu)} aria-label={menu ? 'Close menu' : 'Open menu'} className="up-icon inline-flex items-center justify-center lg:hidden">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                {menu ? (
                  <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>
                ) : (
                  <><line x1="3" y1="7" x2="21" y2="7" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="17" x2="21" y2="17" /></>
                )}
              </svg>
            </button>
          </div>
        </div>
      </nav>
      </div>

      {menuRendered && (
        <div ref={menuRef} className={`mobile-menu fixed inset-0 z-40 bg-bg px-6 overflow-y-auto ${menuClosing ? 'is-closing' : ''}`} style={{ paddingTop: 'calc(var(--site-header-h, 96px) + 20px)' }} role="dialog" aria-modal="true" aria-label="Menu">
          {/* New Drop highlight tile — only while a real drop is actually
              upcoming/early-access (see hasActiveDrop above); otherwise this
              would be meaningless navigation pointing at an empty page. */}
          {hasActiveDrop && (
            <a
              href={pageToPath('drop')}
              onClick={(e) => { e.preventDefault(); navigate('drop'); setMenu(false); }}
              className="mobile-menu-hero relative block overflow-hidden mb-8"
              style={{ aspectRatio: '16/7' }}
            >
              <img
                src="https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=900&h=400&fit=crop&auto=format&q=80"
                alt=""
                className="up-photo absolute inset-0 w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5">
                <p className="text-[9px] font-mono text-accent-light tracking-[0.25em] uppercase mb-1">Just Announced</p>
                <p className="font-display font-black uppercase text-white text-2xl leading-none">New Drop</p>
              </div>
            </a>
          )}

          <div className="mobile-menu-list flex flex-col gap-6">
            <button onClick={() => { setMenu(false); setSearchOpen(true); }} className="text-left font-display font-black text-4xl uppercase">
              {t('Search')}
            </button>
            {[...links.filter(([, page]) => page !== 'drop'), ['Wishlist', 'wishlist'], [user ? 'Account' : 'Login', user ? 'account' : 'login']].map(([label, page]) => (
              <div key={page}>
                <a href={pageToPath(page)} onClick={(e) => { e.preventDefault(); navigate(page); setMenu(false); }} className="text-left font-display font-black text-4xl uppercase block">
                  {t(label)}
                </a>
                {page === 'shop' && (
                  <div className="flex flex-col gap-3 mt-3 pl-1">
                    {CATEGORIES.map((category) => (
                      <a
                        key={category}
                        href={pageToPath('shop')}
                        onClick={(e) => { e.preventDefault(); navigate('shop', { category }); setMenu(false); }}
                        className="text-left font-mono text-sm uppercase tracking-widest text-muted hover:text-fg transition-colors"
                      >
                        {t(CATEGORY_LABELS[category])}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <div className="mobile-preferences pb-10">
              <HeaderSelect key={`mobile-language-${language}`} selectId="language" type="language" value={language} options={languages} onChange={setLanguage} translateLabel={t} openId={mobilePrefOpen} setOpenId={setMobilePrefOpen} />
              <HeaderSelect key={`mobile-currency-${currency}`} selectId="currency" type="currency" value={currency} options={currencies} onChange={setCurrency} translateLabel={t} openId={mobilePrefOpen} setOpenId={setMobilePrefOpen} />
            </div>
          </div>
        </div>
      )}

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
