import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, pageToPath } from '../context/AppContext';
import { handleImgError, FALLBACK_SRC } from '../utils/imageFallback';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { triggerProductContinuity } from '../utils/productContinuity';
export default function ProductCard({ product, showQuickAdd = true }) {
    const { navigate, addToCart, toggleWishlist, isWishlisted, formatMoney } = useApp();
    const [showSizes, setShowSizes] = useState(false);
    const [sheetOpen, setSheetOpen] = useState(false);
    const [activeColor, setActiveColor] = useState(product.colors[0]);
    const sheetRef = useRef(null);
    const imgRef = useRef(null);
    useDialogBehavior(sheetOpen, () => setSheetOpen(false), sheetRef);
    const wishlisted = isWishlisted(product.id);
    const href = pageToPath('product', product);
    // Real product images only — a product with none configured yet (or
    // only an invalid/unreachable one, which onError below still catches)
    // gets the same neutral placeholder tile ProductPage.jsx uses, never a
    // blank/broken <img>.
    const galleryImages = product.images?.length ? product.images : [FALLBACK_SRC];
    // A product only reads as genuinely on sale when it has a real,
    // currently-valid selling price to discount from — never derived from a
    // hardcoded percentage.
    const hasValidPrice = Number(product.price) > 0;
    const onSale = hasValidPrice && Number(product.compareAtPrice) > Number(product.price);
    const discountPct = onSale ? Math.round((1 - product.price / product.compareAtPrice) * 100) : 0;
    const variantStock = (size, color) => {
        if (!product.stockTracked) return null;
        const qty = product.stock?.[`${size}|${color}`];
        return Number.isFinite(qty) ? qty : 0;
    };
    const handleNavigate = (e) => {
        e.preventDefault();
        navigate('product', product);
    };
    const handleImageNavigate = (e) => {
        e.preventDefault();
        // Product → product-page continuity illusion. Handed off to
        // ProductContinuityLayer (mounted at the App root, outside any
        // page) via triggerProductContinuity rather than local state here —
        // this card is about to unmount in the very same render as the
        // route change below, so state living on it would never get a
        // chance to paint. See productContinuity.js for the full story.
        // Not a true FLIP/shared-element transition (that needs to measure
        // a destination element that doesn't exist yet); this never delays
        // or depends on navigate(), so it can't break routing, back/
        // forward, or scroll restoration even if skipped entirely.
        if (imgRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            triggerProductContinuity(product.images[0], imgRef.current.getBoundingClientRect());
        }
        navigate('product', product);
    };
    const handleQuickAdd = (e) => {
        e.stopPropagation();
        if (!showQuickAdd)
            return;
        // Limited-edition pieces require picking a numbered edition, which only
        // the full product page can do — quick-add can't silently skip that step.
        if (product.isLimitedEdition) {
            navigate('product', product);
            return;
        }
        setActiveColor(product.colors[0]);
        // Mobile gets a proper bottom-sheet (matches the rest of the site's
        // overlay pattern) instead of an inline row that pushes card content —
        // desktop keeps the hover-reveal inline row, which has room for it.
        if (window.innerWidth < 1024) {
            setSheetOpen(true);
        }
        else {
            setShowSizes(true);
        }
    };
    const handleSelectSize = (e, size, color = product.colors[0]) => {
        e.stopPropagation();
        if (variantStock(size, color) === 0)
            return;
        addToCart({ product, size, color, quantity: 1 });
        setShowSizes(false);
        setSheetOpen(false);
    };
    const handleWishlist = (e) => {
        e.stopPropagation();
        toggleWishlist(product.id);
    };
    return (<div className="group">
      {/* Image container */}
      <div className="relative img-swap-container bg-card" style={{ aspectRatio: '3/4' }}>
        <a href={href} onClick={handleImageNavigate} className="absolute inset-0 z-0 cursor-pointer" aria-hidden="true" tabIndex={-1}>
          <img ref={imgRef} src={galleryImages[0]} onError={handleImgError} alt={product.name} loading="lazy" decoding="async" className="up-photo img-swap-front absolute inset-0 w-full h-full object-cover"/>
          {galleryImages[1] && (<img src={galleryImages[1]} onError={handleImgError} alt={`${product.name} alternate`} loading="lazy" decoding="async" className="up-photo img-swap-back"/>)}
        </a>

        {/* Badges */}
        <div className="absolute top-3 left-3 flex flex-col gap-1.5 z-10">
          {onSale && (<span className="bg-error text-white text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase" style={{ backgroundColor: 'var(--color-error)' }}>
              -{discountPct}%
            </span>)}
          {product.isNew && (<span className="bg-accent text-white text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase">
              New
            </span>)}
          {product.isSoldOut && (<span className="bg-muted text-bg text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase">
              Sold Out
            </span>)}
          {/* A product with no valid selling price yet isn't purchasable —
              never shown as "AMD 0"/"$0.00" as if it were. */}
          {!product.isSoldOut && !hasValidPrice && (<span className="bg-muted text-bg text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase">
              Coming Soon
            </span>)}
          {!product.isSoldOut && product.isLowStock && (<span className="border border-accent text-accent-light text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase bg-bg/80">
              Low Stock
            </span>)}
          {product.dropStatus === 'early-access' && (<span className="border border-border text-fg text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase bg-bg/80">
              Early Access
            </span>)}
          {product.dropStatus === 'members-only' && (<span className="border border-border text-fg text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase bg-bg/80">
              Members
            </span>)}
        </div>

        {/* Wishlist */}
        <button onClick={handleWishlist} className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-200" aria-label={wishlisted ? 'Remove from wishlist' : 'Add to wishlist'}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill={wishlisted ? '#C65D1E' : 'none'} stroke={wishlisted ? '#C65D1E' : '#F5F5F3'} strokeWidth="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </button>

        {/* Quick add (desktop inline row) — never offered for a product
            that isn't really purchasable yet (sold out, or no valid price
            configured). */}
        {showQuickAdd && !product.isSoldOut && hasValidPrice && (<div className="absolute bottom-0 left-0 right-0 z-10">
            {showSizes ? (<div className="bg-bg/95 backdrop-blur-sm border-t border-border flex">
                {product.sizes.map(size => {
                const soldOut = variantStock(size, product.colors[0]) === 0;
                return (<button key={size} disabled={soldOut} onClick={e => handleSelectSize(e, size)} className={`flex-1 py-2.5 text-[10px] font-mono tracking-widest uppercase transition-colors border-r border-border last:border-r-0 ${soldOut ? 'text-muted/30 line-through cursor-not-allowed' : 'text-fg hover:bg-accent hover:text-white'}`}>
                    {size}
                  </button>);
            })}
              </div>) : (<button onClick={handleQuickAdd} className="w-full py-3 bg-bg/90 backdrop-blur-sm border-t border-border text-[10px] font-mono tracking-[0.2em] uppercase text-fg opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity duration-300 hover:bg-accent hover:text-white hover:border-accent transition-colors">
                Quick Add
              </button>)}
          </div>)}
      </div>

      {/* Quick add (mobile bottom sheet) — portaled to <body>: this component
          renders from inside a page's `.page-transition` wrapper, whose fade
          animation leaves a `transform` on that ancestor after it finishes
          (animation-fill-mode: both), which makes it a new containing block
          for any `position: fixed` descendant — breaking the sheet's
          positioning. Escaping via a portal keeps it truly viewport-fixed. */}
      {sheetOpen && createPortal(<div className="fixed inset-0 z-[200] lg:hidden">
          <button className="absolute inset-0 bg-[var(--overlay-scrim)] backdrop-blur-sm border-0" aria-label="Close" onClick={() => setSheetOpen(false)} />
          <div ref={sheetRef} role="dialog" aria-modal="true" aria-label={`Quick add ${product.name}`} className="quick-add-sheet absolute inset-x-0 bottom-0 bg-bg border-t border-border p-6 pb-8">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-1">{product.subtitle}</p>
                <h3 className="font-display font-black uppercase text-xl leading-tight">{product.name}</h3>
              </div>
              <button onClick={() => setSheetOpen(false)} aria-label="Close" className="shrink-0 w-9 h-9 flex items-center justify-center border border-border">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>

            {product.colors.length > 1 && (<div className="mb-5">
                <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-2">Colour: <span className="text-fg">{activeColor}</span></p>
                <div className="flex gap-2">
                  {product.colors.map(color => (<button key={color} onClick={(e) => { e.stopPropagation(); setActiveColor(color); }} className={`text-[10px] font-mono tracking-widest uppercase px-3 py-2 border ${activeColor === color ? 'border-fg text-fg bg-[var(--active-overlay)]' : 'border-border text-muted'}`}>
                      {color}
                    </button>))}
                </div>
              </div>)}

            <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-2">Size</p>
            <div className="grid grid-cols-6 gap-1.5">
              {product.sizes.map(size => {
            const soldOut = variantStock(size, activeColor) === 0;
            return (<button key={size} disabled={soldOut} onClick={e => handleSelectSize(e, size, activeColor)} className={`py-3 text-[11px] font-mono tracking-wide uppercase border transition-colors ${soldOut ? 'border-border text-muted/30 line-through cursor-not-allowed' : 'border-border text-muted hover:border-fg/40 hover:text-fg'}`}>
                  {size}
                </button>);
        })}
            </div>
          </div>
        </div>, document.body)}

      {/* Info */}
      <a href={href} onClick={handleNavigate} className="block pt-3 pb-1 cursor-pointer">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 transition-transform duration-300 ease-out group-hover:translate-x-0.5">
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-mono text-muted tracking-widest uppercase mb-0.5">
              {product.subtitle}
            </p>
            <h3 className="text-sm font-body font-medium text-fg leading-tight group-hover:text-muted transition-colors">
              {product.name}
            </h3>
          </div>
          <span className="text-sm font-mono shrink-0 flex items-baseline gap-1.5">
            {/* No valid price configured yet (Admin → Products) — never
                rendered as "$0.00"/"AMD 0" like a real, purchasable price. */}
            {hasValidPrice ? (<>
              <span className={onSale ? 'text-accent-light' : 'text-fg'}>{formatMoney(product.price)}</span>
              {onSale && <span className="text-muted line-through text-[12px]">{formatMoney(product.compareAtPrice)}</span>}
            </>) : (
              <span className="text-muted text-[11px] tracking-widest uppercase">Coming Soon</span>
            )}
          </span>
        </div>
        <div className="flex gap-1.5 mt-2">
          {product.colors.map(color => (<span key={color} className="text-[10px] font-mono text-muted tracking-wide">
              {color}
            </span>))}
        </div>
      </a>
    </div>);
}
