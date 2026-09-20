import { useEffect, useRef, useState } from 'react';
import { useApp, pageToPath } from '../context/AppContext';

// Hoodies split out as its own category (previously lumped in with "tops")
// since it's currently the only category with live/purchasable products —
// the others stay in navigation but render a "coming soon" state on the
// Shop page instead of an empty grid.
export const CATEGORIES = ['hoodies', 'tops', 'bottoms', 'outerwear', 'accessories'];
export const CATEGORY_LABELS = { hoodies: 'Hoodies', tops: 'T-Shirts', bottoms: 'Pants', outerwear: 'Outerwear', accessories: 'Accessories' };

// JS-controlled open state rather than pure CSS :hover — a CSS-only
// group-hover version left the panel visually stuck open after the page
// scrolled under a stationary cursor, since browsers only re-evaluate
// :hover on pointer movement, not on scroll. Tracking `open` explicitly and
// closing it on scroll fixes that; mouse and keyboard behavior (via
// focus/blur) are both still supported.
function MegaMenuShell({ label, href, onNavigate, panel }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, { passive: true });
    return () => window.removeEventListener('scroll', close);
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!rootRef.current?.contains(e.relatedTarget)) setOpen(false); }}
    >
      <a href={href} onClick={onNavigate} className="up-nav">{label}</a>
      <div className={`${open ? 'visible opacity-100 translate-y-0' : 'invisible opacity-0 translate-y-1'} transition-all duration-200 absolute left-0 top-full pt-5 z-50`}>
        <div className="bg-bg border border-border shadow-2xl w-[min(90vw,480px)]">
          {panel}
        </div>
      </div>
    </div>
  );
}

// Brand panel shown instead of product photos in the Shop hover menu. Plays
// an admin-uploaded video (Admin → Site Content → Shop Menu) when one's been
// set; otherwise falls back to a plain wordmark treatment (matching
// Footer.css's `.site-footer__wordmark` oversized-brand-text idea, scaled
// down to fit this panel).
function ShopMegaMenuBrandPanel({ video }) {
  if (video?.videoUrl) {
    return (
      <div className="relative overflow-hidden bg-card border-l border-border h-full min-h-[220px]">
        <video
          src={video.videoUrl}
          poster={video.posterUrl || undefined}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
    );
  }
  return (
    <div className="relative flex items-center justify-center overflow-hidden bg-card border-l border-border h-full min-h-[220px]">
      <p
        aria-hidden="true"
        className="font-display font-black uppercase text-fg leading-[0.85] text-center select-none"
        style={{ fontSize: 'clamp(28px, 6vw, 48px)', letterSpacing: '-0.02em', opacity: 0.14, whiteSpace: 'nowrap' }}
      >
        Urban
        <br />
        Phoenix
      </p>
    </div>
  );
}

export function ShopMegaMenu({ navigate }) {
  const { t, content } = useApp();
  const go = (e) => { e.preventDefault(); navigate('shop'); };

  return (
    <MegaMenuShell
      label={t('Shop')}
      href={pageToPath('shop')}
      onNavigate={go}
      panel={
        <div className="grid grid-cols-[1fr_1fr]">
          <div className="p-8">
            <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-5">Shop By Category</p>
            <ul className="space-y-3">
              {CATEGORIES.map((category) => (
                <li key={category}>
                  <a
                    href={pageToPath('shop')}
                    onClick={(e) => { e.preventDefault(); navigate('shop', { category }); }}
                    className="text-sm font-body text-fg hover:text-accent transition-colors"
                  >
                    {t(CATEGORY_LABELS[category])}
                  </a>
                </li>
              ))}
            </ul>
            <a href={pageToPath('shop')} onClick={go} className="inline-block mt-6 text-[11px] font-mono tracking-[0.2em] uppercase text-accent hover:text-accent-light transition-colors">
              {t('Shop All')} →
            </a>
          </div>
          <ShopMegaMenuBrandPanel video={content.shopMenuVideo} />
        </div>
      }
    />
  );
}
