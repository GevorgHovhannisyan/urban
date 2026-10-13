import { useRef } from 'react';
import { useApp, pageToPath } from '../context/AppContext';
import { handleImgError, FALLBACK_SRC } from '../utils/imageFallback';
import { triggerProductContinuity } from '../utils/productContinuity';
export default function ProductCard({ product }) {
    const { navigate, toggleWishlist, isWishlisted, formatMoney } = useApp();
    const imgRef = useRef(null);
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

      </div>

      {/* Info */}
      <a href={href} onClick={handleNavigate} className="block pt-3 pb-1 cursor-pointer">
        {/* Stacked by default, inline from lg: up — matching the breakpoint
            the product grids themselves switch column count at (2 cols
            below lg, more above). Sharing one row with justify-between
            let the price span squeeze the flexible title column down to
            almost nothing on a narrow 2-column card, wrapping a short
            title one word per line; stacking removes that competition for
            width entirely instead of trying to out-shrink it. */}
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-x-2 gap-y-1 transition-transform duration-300 ease-out group-hover:translate-x-0.5">
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
