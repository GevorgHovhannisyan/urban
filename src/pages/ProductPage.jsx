import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { getRelatedProducts } from '../data/productHelpers';
import ProductCard from '../components/ProductCard';
import ScrollReveal from '../components/ScrollReveal';
import SizeGuideDrawer from '../components/SizeGuideDrawer';
import ProductReviewForm from '../components/ProductReviewForm';
import LimitedEditionSelector from '../components/LimitedEditionSelector';
import GarmentExplorer from '../components/GarmentExplorer';
import DragGallery from '../components/DragGallery';
import { handleImgError, FALLBACK_SRC } from '../utils/imageFallback';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { Block, TextLinesSkeleton } from '../components/Skeleton';
import Icon from '../components/Icon';
import { useMagnetic } from '../hooks/useMagnetic';
import { FREE_US_SHIPPING_THRESHOLD, ARMENIA_MAX_DELIVERY_DAYS, US_MAX_DELIVERY_DAYS } from '../data/shippingRules';
// Accordion keys stay stable (openSections, tabContent) — only the
// customer-facing label changes, separating emotional "Product Story" copy
// from the technical spec sections per the storytelling/technical split.
const SECTION_LABELS = {
    details: 'Product Story',
    materials: 'Material',
    care: 'Care',
    shipping: 'Shipping',
};
function StarRating({ rating }) {
    return (<div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (<svg key={i} width="12" height="12" viewBox="0 0 24 24" fill={i <= rating ? '#C65D1E' : 'none'} stroke={i <= rating ? '#C65D1E' : 'var(--color-muted)'} strokeWidth="1.5">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>))}
    </div>);
}
export default function ProductPage({ product }) {
    const { addToCart, toggleWishlist, isWishlisted, navigate, formatMoney, t, products, recentlyViewed, trackProductView, visitorCountry, isUnitedStates } = useApp();
    const [selectedSize, setSelectedSize] = useState('');
    const [selectedColor, setSelectedColor] = useState(product.colors[0]);
    const [quantity, setQuantity] = useState(1);
    const [editionNumbers, setEditionNumbers] = useState([]);
    const [editionError, setEditionError] = useState(false);
    const [activeImage, setActiveImage] = useState(0);
    const [openSections, setOpenSections] = useState(() => new Set(['details']));
    const [sizeError, setSizeError] = useState(false);
    const [lightboxOpen, setLightboxOpen] = useState(false);
    const [addedMsg, setAddedMsg] = useState(false);
    const [sizeGuideOpen, setSizeGuideOpen] = useState(false);
    const [customerReviews, setCustomerReviews] = useState([]);
    const [reviewsLoading, setReviewsLoading] = useState(true);
    // Live, backend-sourced edition availability — product.isSoldOut only
    // reflects size/color stock, never edition_sales, so a Limited Edition
    // product with every serial already claimed but stock still nonzero
    // would otherwise keep showing an active Add to Bag button that could
    // never actually complete (LimitedEditionSelector would show 0
    // available, and claimEditions() would reject at checkout regardless).
    // Fetched once per product from the same authoritative endpoint
    // LimitedEditionSelector itself uses, so the page can show a real SOLD
    // OUT state up front instead of only discovering it two steps later.
    const [editionAvailability, setEditionAvailability] = useState(null);
    const lightboxRef = useRef(null);
    useDialogBehavior(lightboxOpen, () => setLightboxOpen(false), lightboxRef);
    const addToBagRef = useMagnetic(4);
    const buyNowRef = useMagnetic(4);

    // Selection state must reset per product — otherwise navigating from one
    // product to another (e.g. via "related products") keeps the previous
    // product's color/size/quantity/edition numbers selected, which can add
    // the wrong variant to the cart or burn limited-edition numbers against
    // the wrong item.
    useEffect(() => {
      setSelectedSize('');
      setSelectedColor(product.colors[0]);
      setQuantity(1);
      setEditionNumbers([]);
      setEditionError(false);
      setActiveImage(0);
      setOpenSections(new Set(['details']));
      setSizeError(false);
      setLightboxOpen(false);
      setAddedMsg(false);
      setSizeGuideOpen(false);
      setEditionAvailability(null);
      trackProductView(product.id);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [product.id]);

    useEffect(() => {
      let cancelled = false;
      setReviewsLoading(true);
      fetch(`/api/reviews?productId=${encodeURIComponent(product.id)}`)
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (!cancelled && ok) setCustomerReviews(Array.isArray(data.reviews) ? data.reviews : []);
        })
        .catch(() => {})
        .finally(() => { if (!cancelled) setReviewsLoading(false); });
      return () => { cancelled = true; };
    }, [product.id]);

    useEffect(() => {
      if (!product.isLimitedEdition) { setEditionAvailability(null); return; }
      let cancelled = false;
      fetch(`/api/editions?productId=${encodeURIComponent(product.id)}`)
        .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
        .then(({ ok, data }) => {
          if (!cancelled && ok) setEditionAvailability({ total: Number(data.total) || 0, sold: Array.isArray(data.sold) ? data.sold.length : 0 });
        })
        .catch(() => {});
      return () => { cancelled = true; };
    }, [product.id, product.isLimitedEdition]);

    const visibleReviews = customerReviews;
    const averageRating = useMemo(() => {
      if (!visibleReviews.length) return 0;
      return visibleReviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / visibleReviews.length;
    }, [visibleReviews]);

    const variantStock = (size, color) => {
      if (!product.stockTracked) return null;
      const qty = product.stock?.[`${size}|${color}`];
      return Number.isFinite(qty) ? qty : 0;
    };
    const selectedVariantStock = variantStock(selectedSize, selectedColor);
    // Real product variants only — a single/no color never gets a selector
    // (nothing to choose), and an unconfigured product (no sizes entered in
    // Admin yet, e.g. a just-launched placeholder) is never offered as
    // normally purchasable — it gets an honest "Coming Soon" state instead
    // of a size selector with nothing in it and a permanently-stuck "please
    // select a size" error.
    // Real product images only, from the product/API record — final
    // photoshoot images can be uploaded through Admin with zero frontend
    // changes since this always reads product.images directly. When a
    // product has none configured yet, one neutral placeholder tile takes
    // its place (the same broken/missing-image fallback already used
    // elsewhere — see utils/imageFallback.js) rather than an empty box.
    const galleryImages = product.images?.length ? product.images : [FALLBACK_SRC];
    const hasMultipleColors = product.colors.length > 1;
    const hasSizes = product.sizes.length > 0;
    const allEditionsSold = Boolean(product.isLimitedEdition && editionAvailability && editionAvailability.total > 0 && editionAvailability.sold >= editionAvailability.total);
    const effectiveSoldOut = product.isSoldOut || allEditionsSold;
    const wishlisted = isWishlisted(product.id);
    const related = getRelatedProducts(product, 4, products);
    const recentlyViewedProducts = recentlyViewed
      .filter((id) => id !== product.id)
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean)
      .slice(0, 4);
    const handleAddToCart = () => {
        if (effectiveSoldOut || !hasSizes) return;
        if (!selectedSize) {
            setSizeError(true);
            return;
        }
        if (selectedVariantStock === 0) return;
        if (product.isLimitedEdition && editionNumbers.length !== quantity) { setEditionError(true); return; }
        setSizeError(false);
        setEditionError(false);
        addToCart({ product, size: selectedSize, color: selectedColor, quantity, editionNumbers });
        setAddedMsg(true);
        setTimeout(() => setAddedMsg(false), 2500);
    };
    const handleBuyNow = () => {
        if (effectiveSoldOut || !hasSizes) return;
        if (!selectedSize) {
            setSizeError(true);
            return;
        }
        if (selectedVariantStock === 0) return;
        if (product.isLimitedEdition && editionNumbers.length !== quantity) { setEditionError(true); return; }
        setEditionError(false);
        addToCart({ product, size: selectedSize, color: selectedColor, quantity, editionNumbers });
        navigate('cart');
    };
    const tabContent = {
        details: product.description,
        materials: product.materials,
        care: product.care,
        shipping: `${product.shipping}\n\n${product.returns}`,
    };
    return (<main className="bg-bg min-h-screen pt-[var(--site-header-h,68px)]">
      {/* Breadcrumb */}
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 py-4 flex items-center gap-2">
        <button onClick={() => navigate('home')} className="text-[10px] font-mono text-muted hover:text-fg transition-colors tracking-wide uppercase">Home</button>
        <span className="text-muted/40 text-[10px] font-mono">/</span>
        <button onClick={() => navigate('shop')} className="text-[10px] font-mono text-muted hover:text-fg transition-colors tracking-wide uppercase">Shop</button>
        <span className="text-muted/40 text-[10px] font-mono">/</span>
        <span className="text-[10px] font-mono text-fg/70 tracking-wide uppercase truncate max-w-[160px]">{product.name}</span>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 pb-20">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-16">
          {/* Gallery — edge-to-edge swipeable scroll-snap carousel on mobile,
              single image + thumbnail rail on desktop */}
          <div className="space-y-3 -mx-6 lg:mx-0">
            <div className="flex lg:hidden overflow-x-auto snap-x snap-mandatory" style={{ scrollbarWidth: 'none' }}>
              {galleryImages.map((img, i) => (
                <div key={i} className="relative shrink-0 w-full snap-center bg-card" style={{ aspectRatio: '4/5' }} onClick={() => { setActiveImage(i); setLightboxOpen(true); }}>
                  <img src={img} onError={handleImgError} alt={product.name} fetchPriority={i === 0 ? 'high' : undefined} loading={i === 0 ? undefined : 'lazy'} className="w-full h-full up-photo object-cover"/>
                  {i === 0 && product.isNew && (<div className="absolute top-4 left-4">
                      <span className="bg-accent text-white text-[10px] font-mono tracking-widest uppercase px-2 py-0.5">New</span>
                    </div>)}
                </div>
              ))}
            </div>
            {galleryImages.length > 1 && (
              <div className="flex lg:hidden justify-center gap-1.5 -mt-1 mx-6">
                {galleryImages.map((_, i) => (<span key={i} className="w-1.5 h-1.5 rounded-full bg-white/25" />))}
              </div>
            )}

            {/* Main image (desktop) — every image in the gallery is stacked
                and cross-fades via opacity/scale/blur on switch (see
                .gallery-stage-img in index.css) instead of the <img> src
                swapping instantly, which used to hard-cut between photos. */}
            <div className="hidden lg:block relative overflow-hidden bg-card cursor-zoom-in" style={{ aspectRatio: '4/5' }} onClick={() => setLightboxOpen(true)}>
              {galleryImages.map((img, i) => (
                <img
                  key={img + i}
                  src={img}
                  onError={handleImgError}
                  alt={product.name}
                  fetchPriority={i === 0 ? 'high' : undefined}
                  loading={i === 0 ? undefined : 'lazy'}
                  className={`gallery-stage-img up-photo ${i === activeImage ? 'is-active' : ''}`}
                />
              ))}
              {product.isNew && (<div className="absolute top-4 left-4 z-10">
                  <span className="bg-accent text-white text-[10px] font-mono tracking-widest uppercase px-2 py-0.5">New</span>
                </div>)}
              <div className="absolute bottom-4 right-4 z-10 text-[10px] font-mono text-muted bg-bg/60 px-2 py-1 tracking-wide">
                Zoom
              </div>
            </div>

            {/* Thumbnails (desktop) */}
            {galleryImages.length > 1 && (<div className="hidden lg:flex gap-2">
                {galleryImages.map((img, i) => (<button key={i} onClick={() => setActiveImage(i)} className={`relative overflow-hidden bg-card transition-all duration-200 ${activeImage === i ? 'ring-1 ring-accent' : 'opacity-50 hover:opacity-80'}`} style={{ width: '72px', aspectRatio: '3/4' }}>
                    <img src={img} onError={handleImgError} alt="" className="w-full h-full up-photo object-cover"/>
                  </button>))}
              </div>)}
          </div>

          {/* Product info — sticky alongside the gallery on desktop */}
          <div className="lg:pt-4 lg:sticky lg:top-[calc(var(--site-header-h,68px)+24px)] lg:self-start">
            <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-3">
              {product.collection}
            </p>
            <h1 className="font-display font-black uppercase text-fg leading-[0.92] mb-4" style={{ fontSize: 'clamp(2.5rem, 4vw, 4rem)', letterSpacing: '-0.015em' }}>
              {product.name}
            </h1>
            <div className="product-price-row">
              <p className={`text-2xl font-mono mb-6 ${product.compareAtPrice > product.price ? 'text-accent-light' : 'text-fg'}`}>
                {formatMoney(product.price)}
                {product.compareAtPrice > product.price && (
                  <>
                    <span className="text-muted line-through text-base ml-3">{formatMoney(product.compareAtPrice)}</span>
                    <span className="ml-3 align-middle bg-error text-white text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase" style={{ backgroundColor: 'var(--color-error)' }}>
                      -{Math.round((1 - product.price / product.compareAtPrice) * 100)}%
                    </span>
                  </>
                )}
              </p>
            </div>

            {/* Color selector — only for a product with a real choice to
                make; one color (or none yet configured) shows nothing here
                rather than a selector with nothing to select. */}
            {hasMultipleColors && (
              <div className="mb-6">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase">Colour</p>
                  <p className="text-[11px] font-mono text-fg">{selectedColor}</p>
                </div>
                <div className="flex gap-2">
                  {product.colors.map(color => (<button key={color} onClick={() => setSelectedColor(color)} className={`text-[10px] font-mono tracking-widest uppercase px-3 py-2 border transition-all duration-150 ${selectedColor === color
                  ? 'border-fg text-fg bg-[var(--hover-overlay)]'
                  : 'border-border text-muted hover:border-fg/40 hover:text-fg'}`}>
                      {color}
                    </button>))}
                </div>
              </div>
            )}

            {/* Size selector */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-3">
                <p className={`text-[10px] font-mono tracking-[0.2em] uppercase ${sizeError ? 'text-accent' : 'text-muted'}`}>
                  {sizeError ? 'Please select a size' : 'Size'}
                </p>
                {hasSizes && (
                  <button type="button" onClick={() => setSizeGuideOpen(true)} className="text-[10px] font-mono text-muted underline underline-offset-2 hover:text-fg transition-colors tracking-wide">
                    Size Guide
                  </button>
                )}
              </div>
              {hasSizes ? (<>
                <div className="grid grid-cols-6 gap-1.5">
                  {product.sizes.map(size => {
                    const qty = variantStock(size, selectedColor);
                    const soldOut = qty === 0;
                    return (<button key={size} disabled={soldOut} onClick={() => { setSelectedSize(size); setSizeError(false); }} className={`relative py-3 text-[11px] font-mono tracking-wide uppercase border transition-all duration-150 ${selectedSize === size
                    ? 'border-fg bg-fg text-bg'
                    : soldOut
                        ? 'border-border text-muted/30 cursor-not-allowed line-through'
                        : sizeError
                            ? 'border-accent/50 text-muted hover:border-accent hover:text-fg'
                            : 'border-border text-muted hover:border-fg/40 hover:text-fg'}`}>
                        {size}
                      </button>);
                  })}
                </div>
                {selectedSize && selectedVariantStock !== null && selectedVariantStock > 0 && selectedVariantStock <= 5 && (
                  <p className="mt-2 text-[10px] font-mono text-accent-light tracking-wide uppercase">Only {selectedVariantStock} left</p>
                )}
              </>) : (
                // Real DB state: no sizes have been configured for this
                // product yet (e.g. a just-launched piece Admin hasn't
                // finished setting up) — never invented, never a live-looking
                // size grid with nothing in it.
                <p className="py-3 text-[11px] font-mono tracking-wide uppercase text-muted border border-border text-center">
                  Sizes Coming Soon
                </p>
              )}
            </div>

            {/* Quantity */}
            <div className="mb-8">
              <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-3">Quantity</p>
              <div className="flex items-center border border-border w-fit">
                <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="w-11 h-11 flex items-center justify-center text-muted hover:text-fg transition-colors text-lg border-r border-border">
                  −
                </button>
                <input
                  className="product-quantity-input"
                  type="number"
                  min="1"
                  max="100"
                  value={quantity}
                  onChange={(event) => setQuantity(Math.min(100, Math.max(1, Number(event.target.value) || 1)))}
                  aria-label="Quantity"
                />
                <button disabled={quantity >= 100} onClick={() => setQuantity(q => Math.min(100, q + 1))} className="w-11 h-11 flex items-center justify-center text-muted hover:text-fg transition-colors text-lg border-l border-border">
                  +
                </button>
              </div>
            </div>

            {/* CTAs — Limited Edition selection is a required choice, same as
                size, so it sits above Add to Bag (not after it): the
                customer sees and makes every required selection before
                reaching the purchase action, never below it. */}
            <div className="space-y-3 mb-6">
              {product.isLimitedEdition && !effectiveSoldOut && (
                <>
                  <LimitedEditionSelector
                    productId={product.id}
                    total={product.limitedEditionTotal || 100}
                    quantity={quantity}
                    value={editionNumbers}
                    onChange={(numbers) => { setEditionNumbers(numbers); setEditionError(false); }}
                  />
                  {editionError && <p className="edition-error">{t('Choose one number for each item')}</p>}
                </>
              )}

              {effectiveSoldOut ? (
                <p className="w-full py-4 text-center text-[11px] font-mono tracking-[0.2em] uppercase bg-[var(--hover-overlay)] text-muted border border-border">
                  Sold Out
                </p>
              ) : !hasSizes ? (
                <p className="w-full py-4 text-center text-[11px] font-mono tracking-[0.2em] uppercase bg-[var(--hover-overlay)] text-muted border border-border">
                  Coming Soon
                </p>
              ) : (
                <button ref={addToBagRef} onClick={handleAddToCart} className={`magnetic-btn w-full py-4 text-[11px] font-mono tracking-[0.2em] uppercase ${addedMsg
              ? 'bg-fg text-bg add-to-bag-pulse'
              : 'bg-accent text-white hover:bg-accent-light'}`}>
                  {addedMsg ? '✓ Added to Bag' : 'Add to Bag'}
                </button>
              )}

              {!effectiveSoldOut && hasSizes && (
                <button ref={buyNowRef} onClick={handleBuyNow} className="magnetic-btn w-full py-4 text-[11px] font-mono tracking-[0.2em] uppercase border border-border text-fg hover:bg-[var(--hover-overlay)]">
                  Buy Now
                </button>
              )}
            </div>

            {/* Wishlist */}
            <button onClick={() => toggleWishlist(product.id)} className="flex items-center gap-2 text-[11px] font-mono text-muted hover:text-fg transition-colors tracking-widest uppercase mb-8">
              <svg width="14" height="14" viewBox="0 0 24 24" fill={wishlisted ? '#C65D1E' : 'none'} stroke={wishlisted ? '#C65D1E' : 'currentColor'} strokeWidth="1.5">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
              </svg>
              {wishlisted ? 'Saved to Wishlist' : 'Save to Wishlist'}
            </button>

            {/* USPs */}
            <div className="grid grid-cols-4 gap-4 border-t border-border pt-6 mb-6">
              {[
            { icon: 'returns', label: 'Free Returns', sub: '14-day policy' },
            { icon: 'truck', label: 'Fast Local Delivery', sub: '1–2 day dispatch' },
            // Real, region-aware shipping messaging — Urban Phoenix currently
            // ships only to Armenia and the United States
            // (SUPPORTED_SHIPPING_COUNTRIES, src/data/countries.js), never a
            // blanket "worldwide"/generic "international" claim. visitorCountry
            // is a detected/UX default only; the real charge and real
            // delivery estimate are always decided by the full address
            // entered at checkout. Armenia shows the honest ceiling (up to
            // ARMENIA_MAX_DELIVERY_DAYS) rather than ever claiming Yerevan-
            // speed delivery here — this page has no shipping city yet, only
            // a detected country, so it can't tell Yerevan from another
            // region; only Checkout (and the order/email/account/admin
            // surfaces after it) knows the real city and can say "up to 3".
            visitorCountry === 'AM'
              ? { icon: 'globe', label: 'Armenia — Free Shipping', sub: `Up to ${ARMENIA_MAX_DELIVERY_DAYS} business days` }
              : isUnitedStates
                ? { icon: 'globe', label: 'United States — Free Shipping', sub: `On orders $${FREE_US_SHIPPING_THRESHOLD}+ · up to ${US_MAX_DELIVERY_DAYS} business days` }
                : { icon: 'globe', label: 'Ships To Armenia & U.S.', sub: 'Select your country at checkout' },
            { icon: 'shieldCheck', label: 'Authentic', sub: 'Quality guaranteed' },
        ].map(item => (<div key={item.label} className="text-center">
                  <Icon name={item.icon} size={20} strokeWidth={1.4} className="text-muted mx-auto mb-1.5" />
                  <p className="text-[10px] font-mono text-fg tracking-wide uppercase">{item.label}</p>
                  <p className="text-[10px] font-mono text-muted mt-0.5">{item.sub}</p>
                </div>))}
            </div>

            {/* Product details accordion — Product Story (description) first,
                then technical specs (Material/Care/Shipping) separately, so
                emotional copy and technical facts never blur into one block.
                A section with no real content for this product (e.g. `care`
                not filled in yet) is skipped entirely rather than expanding
                to an empty panel. */}
            <div className="border-t border-border">
              {['details', 'materials', 'care', 'shipping'].filter(section => tabContent[section]?.trim()).map(section => {
                const isOpen = openSections.has(section);
                return (
                  <div key={section} className="border-b border-border">
                    <button
                      onClick={() => setOpenSections((prev) => {
                        const next = new Set(prev);
                        if (next.has(section)) next.delete(section); else next.add(section);
                        return next;
                      })}
                      aria-expanded={isOpen}
                      className="w-full flex items-center justify-between py-4 text-left text-[10px] font-mono tracking-[0.15em] uppercase text-fg hover:text-muted transition-colors"
                    >
                      {SECTION_LABELS[section]}
                      <span className={`transition-transform duration-200 ${isOpen ? 'rotate-45' : ''}`}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                      </span>
                    </button>
                    <div className={`product-accordion-panel ${isOpen ? 'is-open' : ''}`}>
                      <div className="product-accordion-panel__inner">
                        <p className="pb-5 text-sm font-body font-light text-muted leading-relaxed whitespace-pre-line">
                          {tabContent[section]}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <GarmentExplorer product={product} />

        {/* Reviews — label, heading, and rating summary reveal on a slight
            stagger (not as one block) so the section reads as introduced in
            sequence: small label first, then the statement, then the
            supporting number. */}
        <section className="mt-20 pt-16 border-t border-border">
          <div className="flex items-end justify-between mb-10">
            <div>
              <ScrollReveal>
                <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-2">Customer Reviews</p>
              </ScrollReveal>
              <ScrollReveal delay={100}>
                <h2 className="font-display font-black uppercase text-fg leading-none" style={{ fontSize: 'clamp(2rem, 4vw, 4rem)', letterSpacing: '-0.015em' }}>
                  What They Say
                </h2>
              </ScrollReveal>
            </div>
            {visibleReviews.length > 0 && (
              <ScrollReveal delay={200}>
                <div className="flex items-center gap-3">
                  <div className="flex">
                    {[1, 2, 3, 4, 5].map(i => (<svg key={i} width="14" height="14" viewBox="0 0 24 24" fill="#C65D1E" stroke="#C65D1E" strokeWidth="1">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>))}
                  </div>
                  <span className="text-sm font-mono text-fg">{averageRating.toFixed(1)} / 5</span>
                </div>
              </ScrollReveal>
            )}
          </div>

          {!reviewsLoading && visibleReviews.length === 0 && (
            <p className="text-sm font-body font-light text-muted mb-10">Be the first to review this piece.</p>
          )}

          <div className="grid lg:grid-cols-2 gap-4">
            {visibleReviews.map((review, i) => (<ScrollReveal key={review.id} delay={i * 80}>
                <div className="bg-card border border-border p-6">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-body font-medium text-fg">{review.author}</p>
                        {review.verifiedPurchase && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-mono text-accent tracking-widest uppercase">
                            <Icon name="shieldCheck" size={11} strokeWidth={1.8} />
                            {/* Only ever "Owner of Piece X/100" when this
                                exact review is genuinely tied to a real
                                serialized purchase (review.pieceNumbers,
                                backend-confirmed — see server/review-api.mjs) —
                                every other verified buyer reads "Verified Owner". */}
                            {review.pieceNumbers?.length
                              ? `Owner Of Piece ${String(review.pieceNumbers[0]).padStart(3, '0')} / ${String(review.pieceEditionTotal || 100).padStart(3, '0')}`
                              : 'Verified Owner'}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono text-muted">{review.date}</p>
                    </div>
                    <StarRating rating={review.rating}/>
                  </div>
                  <p className="text-sm font-body font-light text-muted leading-relaxed">{review.body}</p>
                </div>
              </ScrollReveal>))}
            {reviewsLoading && Array.from({ length: 2 }).map((_, i) => (
              <div key={`review-skeleton-${i}`} className="bg-card border border-border p-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="space-y-2">
                    <Block className="h-3.5 w-24" />
                    <Block className="h-2.5 w-16" />
                  </div>
                  <Block className="h-3.5 w-20" />
                </div>
                <TextLinesSkeleton lines={2} />
              </div>
            ))}
          </div>

          <ProductReviewForm
            productId={product.id}
            onCreated={(review) => setCustomerReviews((current) => [review, ...current])}
            onUpdated={(review) => setCustomerReviews((current) => current.map((r) => (r.id === review.id ? review : r)))}
            onDeleted={(id) => setCustomerReviews((current) => current.filter((r) => r.id !== id))}
          />
        </section>

        {/* Related products */}
        {related.length > 0 && (<section className="mt-20 pt-16 border-t border-border">
            <ScrollReveal>
              <div className="flex items-end justify-between mb-10">
                <div>
                  <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-2">You May Also Like</p>
                  <h2 className="font-display font-black uppercase text-fg leading-none" style={{ fontSize: 'clamp(2rem, 4vw, 4rem)', letterSpacing: '-0.015em' }}>
                    Related Pieces
                  </h2>
                </div>
                <button onClick={() => navigate('shop')} className="hidden lg:block text-[11px] font-mono text-muted hover:text-fg transition-colors tracking-[0.2em] uppercase border-b border-muted/30 pb-0.5">
                  View All →
                </button>
              </div>
            </ScrollReveal>
            <DragGallery>
              {related.map((p, i) => (<ScrollReveal key={p.id} delay={i * 80} className="w-[46vw] sm:w-[220px] lg:w-[260px] shrink-0">
                  <ProductCard product={p}/>
                </ScrollReveal>))}
            </DragGallery>
          </section>)}

        {/* Recently viewed */}
        {recentlyViewedProducts.length > 0 && (<section className="mt-20 pt-16 border-t border-border">
            <ScrollReveal>
              <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-2">Your History</p>
              <h2 className="font-display font-black uppercase text-fg leading-none mb-10" style={{ fontSize: 'clamp(2rem, 4vw, 4rem)', letterSpacing: '-0.015em' }}>
                Recently Viewed
              </h2>
            </ScrollReveal>
            <DragGallery>
              {recentlyViewedProducts.map((p, i) => (<ScrollReveal key={p.id} delay={i * 80} className="w-[46vw] sm:w-[220px] lg:w-[260px] shrink-0">
                  <ProductCard product={p}/>
                </ScrollReveal>))}
            </DragGallery>
          </section>)}
      </div>

      {/* Sticky mobile Add-to-Bag bar — portaled to <body> to escape
          App.jsx's `.page-transition` wrapper, whose fade animation leaves a
          `transform` on that ancestor after it finishes, which would
          otherwise break this element's `position: fixed`. */}
      {createPortal(
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-[150] bg-bg/95 backdrop-blur border-t border-border p-3 pb-[calc(env(safe-area-inset-bottom)+12px)] flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-fg truncate">{product.name}</p>
            <p className="text-xs font-mono text-muted">{formatMoney(product.price)}</p>
          </div>
          {effectiveSoldOut ? (
            <span className="px-6 py-3 text-[10px] font-mono tracking-widest uppercase bg-[var(--hover-overlay)] text-muted border border-border shrink-0">Sold Out</span>
          ) : !hasSizes ? (
            <span className="px-6 py-3 text-[10px] font-mono tracking-widest uppercase bg-[var(--hover-overlay)] text-muted border border-border shrink-0">Coming Soon</span>
          ) : (
            <button onClick={handleAddToCart} className={`px-6 py-3 text-[10px] font-mono tracking-[0.2em] uppercase shrink-0 transition-colors ${addedMsg ? 'bg-fg text-bg' : 'bg-accent text-white hover:bg-accent-light'}`}>
              {addedMsg ? '✓ Added' : 'Add to Bag'}
            </button>
          )}
        </div>,
        document.body
      )}

      <SizeGuideDrawer
        open={sizeGuideOpen}
        onClose={() => setSizeGuideOpen(false)}
        product={product}
        selectedSize={selectedSize}
        selectedColor={selectedColor}
        variantStock={variantStock}
        onSelectSize={size => { setSelectedSize(size); setSizeError(false); }}
      />

      {/* Lightbox — portaled to <body>: this component renders from inside
          App.jsx's `.page-transition` wrapper, whose fade animation leaves a
          `transform` on that ancestor after it finishes (animation-fill-mode:
          both), which makes it a new containing block for any `position:
          fixed` descendant. Without the portal, opening the lightbox after
          scrolling down the page renders the overlay pinned to the full
          scrolled document height instead of the viewport, so the image ends
          up positioned off-screen instead of centered over what's visible. */}
      {lightboxOpen && createPortal(<div ref={lightboxRef} className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center modal-overlay" role="dialog" aria-modal="true" aria-label={`${product.name} image`} onClick={() => setLightboxOpen(false)}>
          <button className="absolute top-6 right-6 text-muted hover:text-fg transition-colors" aria-label="Close image" onClick={() => setLightboxOpen(false)}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
          <img src={galleryImages[activeImage]} onError={handleImgError} alt={product.name} className="max-w-3xl max-h-[90vh] w-full object-contain modal-panel" onClick={e => e.stopPropagation()}/>
          {galleryImages.length > 1 && (<div className="absolute bottom-6 flex gap-3">
              {galleryImages.map((_, i) => (<button key={i} onClick={e => { e.stopPropagation(); setActiveImage(i); }} className={`w-2 h-2 rounded-full transition-colors ${activeImage === i ? 'bg-accent' : 'bg-white/30'}`}/>))}
            </div>)}
        </div>, document.body)}
    </main>);
}
