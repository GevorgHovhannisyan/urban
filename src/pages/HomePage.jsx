import { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import ScrollReveal from '../components/ScrollReveal';
import ProductCard from '../components/ProductCard';
import TrustBar from '../components/TrustBar';
import { ProductGridSkeleton } from '../components/Skeleton';
// getFeaturedProducts/getSaleProducts still back SaleSpotlight below (kept
// defined but unmounted — see the comment at the bottom of this file for
// why). CollectionProducts, the section that actually renders on today's
// homepage, intentionally shows the real catalog directly instead: with
// only 3 live pieces, none of them curated as "featured" yet, an
// isFeatured-filtered section would render empty.
import { getFeaturedProducts, getSaleProducts } from '../data/productHelpers';
import { handleImgError } from '../utils/imageFallback';
import { useMagnetic } from '../hooks/useMagnetic';
function HeroSection() {
    const { navigate, content } = useApp();
    const hero = content.homeHero;
    const primaryCtaRef = useMagnetic(5);
    const secondaryCtaRef = useMagnetic(5);
    const [scrollY, setScrollY] = useState(0);
    useEffect(() => {
        // Reduced motion: skip the scroll listener entirely rather than
        // just zeroing the math below — scrollY stays 0 for the section's
        // whole lifetime, so none of the scroll-driven parallax/scale/fade
        // values below ever move.
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
        const onScroll = () => setScrollY(window.scrollY);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);
    // Subtle scroll-driven hero: the campaign photo moves slower than the
    // page (parallax) and scales up very slightly, while the content block
    // fades/lifts out faster — both clamped to the hero's own height so
    // nothing keeps drifting once the visitor has scrolled well past it.
    const heroScrollT = Math.min(1, scrollY / 700);
    const heroScale = 1 + heroScrollT * 0.06;
    const contentOpacity = Math.max(0, 1 - heroScrollT * 1.6);
    const contentShift = heroScrollT * 40;
    return (<section className="relative w-full h-screen min-h-[600px] overflow-hidden flex items-end noise-overlay">
      {/* BG image/video with parallax */}
      <div className="absolute inset-0" style={{ transform: `translateY(${scrollY * 0.3}px) scale(${heroScale})` }}>
        {hero.videoUrl ? (
          <video src={hero.videoUrl} poster={hero.imageUrl} autoPlay muted loop playsInline className="w-full h-full up-photo object-cover scale-110" />
        ) : (
          // A dedicated mobile crop is optional (Admin → Site Content →
          // Home Hero) — <picture>'s media-query source only ever swaps
          // which single image the browser actually downloads (never both),
          // and falls back to the desktop image below whenever no mobile
          // image has been set, so this never depends on JS viewport
          // detection or risks a blank hero before hydration.
          <picture>
            {hero.mobileImageUrl && <source media="(max-width: 767px)" srcSet={hero.mobileImageUrl} />}
            <img src={hero.imageUrl} onError={handleImgError} alt={hero.imageAlt || ''} fetchPriority="high" className="w-full h-full up-photo object-cover scale-110"/>
          </picture>
        )}
        {/* Gradient overlays — darken the hero photo for text legibility.
            Deliberately literal black regardless of theme (not bg-bg/bg-fg):
            this is a scrim over photography, not page chrome, so it must
            not turn into a light wash in light mode. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-black/10"/>
        <div className="absolute inset-0 bg-gradient-to-r from-black/40 to-transparent"/>
        {/* Darkens further as the visitor scrolls into the hero, so the
            content fading out above it never fights a still-bright photo. */}
        <div className="absolute inset-0 bg-black" style={{ opacity: heroScrollT * 0.35 }}/>
      </div>

      {/* Content */}
      <div className="relative z-10 w-full max-w-screen-2xl mx-auto px-6 lg:px-12 pb-20 lg:pb-28" style={{ opacity: contentOpacity, transform: `translateY(${contentShift}px)` }}>
        {/* Collection label — literal white/black, not text-muted/text-fg:
            this text sits on the permanent photo scrim above, not page
            chrome, so it must not flip with the theme. */}
        <p className="hero-label text-[10px] font-mono tracking-[0.3em] uppercase text-white/70 mb-6">
          {hero.eyebrow}
        </p>

        {/* Headline — each word masks/reveals independently on a stagger
            rather than the whole line fading up as one block, so a large
            campaign statement reads as progressive, editorial motion
            instead of a single generic fade-in. Split on spaces (not
            literal newlines) since the headline is free admin text with no
            guaranteed line breaks — words still wrap naturally per
            viewport width. */}
        <h1 className="font-display font-black uppercase leading-[0.88] text-white" style={{ fontSize: 'clamp(4rem, 11vw, 12rem)', letterSpacing: '-0.02em' }}>
          {hero.headline.split(' ').map((word, i) => (
            <span key={`${word}-${i}`} className="hero-word-mask">
              <span className="hero-word" style={{ animationDelay: `${0.22 + i * 0.08}s` }}>{word}</span>
            </span>
          ))}
        </h1>

        {/* Sub */}
        <p className="hero-sub text-sm font-body font-light text-white/70 mt-6 mb-10 max-w-sm leading-relaxed">
          {hero.subheadline}
        </p>

        {/* CTAs */}
        <div className="hero-cta flex flex-wrap gap-4">
          <button ref={primaryCtaRef} onClick={() => navigate('shop')} className="magnetic-btn bg-accent text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light">
            {hero.primaryCtaText}
          </button>
          <button ref={secondaryCtaRef} onClick={() => navigate('collection')} className="magnetic-btn border border-white/30 text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-white/10">
            {hero.secondaryCtaText}
          </button>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="absolute bottom-8 right-12 hidden lg:flex flex-col items-center gap-2 z-10">
        <div className="w-px h-12 bg-white/20 relative overflow-hidden">
          <div className="w-full bg-white/60 absolute top-0 animate-[scroll_2s_ease-in-out_infinite]" style={{ height: '40%', animation: 'fadeUp 2s ease-in-out infinite' }}/>
        </div>
        <p className="text-[9px] font-mono text-white/70 tracking-[0.25em] uppercase rotate-90 origin-center translate-x-3 mt-2">
          Scroll
        </p>
      </div>
    </section>);
}
function Marquee() {
    const text = 'FREEDOM TO BECOME · COLLECTION 001 · URBAN PHOENIX · BUILT FROM CHAOS · DEFINED BY CHOICE · ';
    return (<div className="border-y border-border py-4 overflow-hidden bg-bg">
      <div className="animate-marquee flex whitespace-nowrap gap-0" style={{ width: 'max-content' }}>
        {Array.from({ length: 4 }).map((_, i) => (<span key={i} className="text-[11px] font-mono tracking-[0.25em] uppercase text-muted pr-0">
            {text}
          </span>))}
      </div>
    </div>);
}
// Short brand statement — the homepage's one confident line, not a
// restatement of the About page's own hero/philosophy. "Character Is
// Built." is Urban Phoenix's core brand idea (see AboutPage.jsx's Brand
// Meaning section, where it's explained in full); here it stands alone.
// Admin-editable (content.brandPhilosophy) — the last word always gets the
// accent color (a generic, design-controlled treatment, not CMS markup) so
// a plain-text field still produces the brand's usual two-tone headline
// without needing any HTML/rich-text in Admin.
function BrandStatement() {
    const { content } = useApp();
    const { headline, subline } = content.brandPhilosophy;
    const words = headline.trim().split(/\s+/);
    const lastWord = words.pop();
    return (<section className="py-24 lg:py-32 bg-bg">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 text-center">
        <ScrollReveal>
          <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-muted mb-8">
            Urban Phoenix
          </p>
          <h2 className="font-display font-black uppercase text-fg leading-[0.9] mb-8" style={{ fontSize: 'clamp(3rem, 7vw, 7rem)', letterSpacing: '-0.02em' }}>
            {words.length > 0 ? `${words.join(' ')} ` : ''}<span className="text-accent">{lastWord}</span>
          </h2>
          <p className="text-sm font-mono text-muted tracking-widest uppercase max-w-md mx-auto">
            {subline}
          </p>
        </ScrollReveal>
      </div>
    </section>);
}

// Limited Edition is a per-product configuration, never a blanket
// Collection 001 property — of the 3 current pieces, only one is actually
// configured isLimitedEdition right now, and "Freedom To Become" (the
// collection's own namesake piece) isn't one of them. This section is
// entirely data-driven: it finds whichever real product is actually
// limited and names THAT piece and ITS real run size, and disappears
// completely the day no product is limited (rather than ever asserting
// "Limited To 100 Pieces" as a universal Collection 001 claim, which is
// what this section used to hardcode).
function LimitedEditionSpotlight() {
    const { navigate, products } = useApp();
    const limitedProduct = products.find((p) => p.isLimitedEdition && Number(p.limitedEditionTotal) > 0);
    if (!limitedProduct) return null;
    return (<section className="py-20 lg:py-28 bg-card border-y border-border">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 text-center">
        <ScrollReveal>
          <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-accent mb-6">Limited Edition</p>
          <h2 className="font-display font-black uppercase text-fg leading-[0.95] mb-6" style={{ fontSize: 'clamp(2rem, 4.5vw, 4rem)', letterSpacing: '-0.015em' }}>
            {limitedProduct.name}.<br />
            <span className="text-accent">Limited To {limitedProduct.limitedEditionTotal} Pieces.</span>
          </h2>
          <p className="text-sm font-body font-light text-muted leading-relaxed max-w-md mx-auto mb-8">
            Each piece is individually numbered. No restock.
          </p>
          <button onClick={() => navigate('product', limitedProduct)} className="border border-fg/30 text-fg px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-[var(--hover-overlay)] transition-colors">
            Select Your Piece
          </button>
        </ScrollReveal>
      </div>
    </section>);
}

// Journal / brand-story teaser — real published posts only (same /api/journal
// feed JournalPage.jsx itself renders from); renders nothing if there's
// nothing published yet, never placeholder cards.
function JournalTeaser() {
    const { navigate } = useApp();
    const [posts, setPosts] = useState([]);
    useEffect(() => {
      let cancelled = false;
      fetch('/api/journal')
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then((d) => { if (!cancelled) setPosts(Array.isArray(d.posts) ? d.posts.slice(0, 3) : []); })
        .catch(() => {});
      return () => { cancelled = true; };
    }, []);
    if (posts.length === 0) return null;
    return (<section className="py-24 lg:py-32 bg-bg">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
        <div className="flex items-end justify-between mb-12">
          <ScrollReveal>
            <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-muted mb-2">Journal</p>
            <h2 className="font-display font-black uppercase text-fg leading-none" style={{ fontSize: 'clamp(2.5rem, 5vw, 5rem)', letterSpacing: '-0.015em' }}>
              The Phoenix World
            </h2>
          </ScrollReveal>
          <ScrollReveal>
            <button onClick={() => navigate('journal')} className="hidden lg:block text-[11px] font-mono tracking-[0.2em] uppercase text-muted hover:text-fg transition-colors border-b border-muted/40 pb-0.5">
              Read The Journal →
            </button>
          </ScrollReveal>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          {posts.map((post, i) => (
            <ScrollReveal key={post.id} delay={i * 80}>
              <a href="/journal" onClick={(e) => { e.preventDefault(); navigate('journal-post', { slug: post.slug }); }} className="group block">
                <div className="relative overflow-hidden bg-card mb-4" style={{ aspectRatio: '4/5' }}>
                  <img src={post.coverImage} onError={handleImgError} alt={post.title} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full up-photo object-cover transition-transform duration-700 group-hover:scale-[1.03]" />
                </div>
                <h3 className="font-display font-black uppercase text-fg leading-tight" style={{ fontSize: '1.2rem' }}>{post.title}</h3>
              </a>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>);
}
function CollectionBanner() {
    const { navigate, content } = useApp();
    const banner = content.homeBanner;
    return (<section className="relative h-[70vh] min-h-[500px] overflow-hidden">
      <img src={banner.imageUrl} onError={handleImgError} alt={banner.imageAlt || ''} loading="lazy" decoding="async" className="absolute inset-0 w-full h-full up-photo object-cover"/>
      <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-transparent"/>
      <div className="absolute inset-0 bg-black/30"/>
      <div className="relative z-10 h-full flex items-center">
        <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 w-full">
          <ScrollReveal>
            <p className="text-[10px] font-mono tracking-[0.3em] uppercase text-white/70 mb-4">
              {banner.eyebrow}
            </p>
            <h2 className="font-display font-black uppercase text-white leading-[0.9] mb-6 max-w-4xl whitespace-pre-line" style={{ fontSize: 'clamp(2.5rem, 6vw, 6rem)', letterSpacing: '-0.02em' }}>
              {banner.headline}
            </h2>
            <p className="text-sm font-body font-light text-white/70 leading-relaxed mb-8 max-w-md">
              {banner.body}
            </p>
            <button onClick={() => navigate('collection')} className="bg-accent text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light transition-colors">
              {banner.ctaText}
            </button>
          </ScrollReveal>
        </div>
      </div>
    </section>);
}
// The homepage's real commercial showcase: the actual current catalog
// (never a curated isFeatured/onSale subset — with only 3 live pieces and
// none yet flagged "featured", that filter would render this section
// empty). Each ProductCard already surfaces its own real sale/new/sold-out
// badges, so a piece that happens to be on sale is shown correctly right
// here without a separate "Sale" section repeating the same 3 products.
// Capped at 6 so this stays a showcase rather than the full catalog once
// Collection 002 and beyond are live — today that cap does nothing, since
// there are only 3.
function CollectionProducts() {
    const { navigate, products, productsStatus } = useApp();
    if (productsStatus === 'error' || (productsStatus === 'success' && products.length === 0)) return null;
    const items = products.slice(0, 6);
    return (<section className="py-24 lg:py-32 bg-bg">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
        <div className="flex items-end justify-between mb-12">
          <ScrollReveal>
            <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-muted mb-2">Collection 001</p>
            <h2 className="font-display font-black uppercase text-fg leading-none" style={{ fontSize: 'clamp(2.5rem, 5vw, 5rem)', letterSpacing: '-0.015em' }}>
              The Pieces
            </h2>
          </ScrollReveal>
          <ScrollReveal>
            <button onClick={() => navigate('shop')} className="hidden lg:block text-[11px] font-mono tracking-[0.2em] uppercase text-muted hover:text-fg transition-colors border-b border-muted/40 pb-0.5">
              View All →
            </button>
          </ScrollReveal>
        </div>

        {productsStatus === 'loading' ? (
          <ProductGridSkeleton count={3} cols={3} />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
            {items.map((product, i) => (<ScrollReveal key={product.id} delay={i * 80}>
                <ProductCard product={product}/>
              </ScrollReveal>))}
          </div>
        )}

        <div className="mt-10 lg:hidden">
          <button onClick={() => navigate('shop')} className="w-full border border-border text-fg py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-[var(--hover-overlay)] transition-colors">
            View All Products
          </button>
        </div>
      </div>
    </section>);
}
function EditorialSection() {
    const { navigate } = useApp();
    return (<section className="bg-bg py-4">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-4">
          {/* Large image */}
          <div className="relative overflow-hidden bg-card group" style={{ aspectRatio: '4/5' }}>
            <img src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=900&h=1125&fit=crop&auto=format&q=85" onError={handleImgError} alt="Urban Phoenix Campaign" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full up-photo object-cover transition-transform duration-700 group-hover:scale-[1.03]"/>
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent"/>
            <div className="absolute bottom-8 left-8 right-8">
              <p className="text-[10px] font-mono text-white/70 tracking-widest uppercase mb-2">Collection 001</p>
              <h3 className="font-display font-black uppercase text-white leading-[0.9]" style={{ fontSize: 'clamp(2.5rem, 4vw, 4rem)' }}>
                The Weight
                <br />
                Of Becoming
              </h3>
            </div>
          </div>

          {/* Right column */}
          <div className="flex flex-col gap-4">
            <div className="relative overflow-hidden bg-card flex-1 group" style={{ minHeight: '280px' }}>
              <img src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&h=600&fit=crop&auto=format&q=85" onError={handleImgError} alt="Urban Phoenix Style" loading="lazy" decoding="async" className="absolute inset-0 w-full h-full up-photo object-cover transition-transform duration-700 group-hover:scale-[1.03]"/>
              <div className="absolute inset-0 bg-black/40"/>
              <div className="absolute inset-0 flex flex-col justify-end p-8">
                <p className="text-[10px] font-mono text-white/70 tracking-widest uppercase mb-2">Our Origin</p>
                <h3 className="font-display font-black uppercase text-white leading-[1.05]" style={{ fontSize: 'clamp(1.5rem, 2.6vw, 2.5rem)' }}>
                  Born In Armenia.
                  <br />
                  Built To Move Beyond It.
                </h3>
              </div>
            </div>

            {/* Brand quote panel — reuses AboutPage.jsx's own "Brand Meaning"
                line rather than CollectionBanner's headline just above ("You
                Do Not Have To Remain Who You Were") so the same sentence
                doesn't appear twice on one homepage. */}
            <div className="bg-card border border-border p-8 lg:p-10 flex flex-col justify-center" style={{ minHeight: '240px' }}>
              <ScrollReveal>
                <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-6">Manifesto</p>
                <blockquote className="font-display font-black uppercase text-fg leading-[0.92]" style={{ fontSize: 'clamp(1.8rem, 3vw, 3rem)', letterSpacing: '-0.01em' }}>
                  "The Phoenix represents
                  <br />
                  <span className="text-accent">the process of rebuilding yourself."</span>
                </blockquote>
                <button onClick={() => navigate('about')} className="mt-8 text-[11px] font-mono text-muted hover:text-fg transition-colors tracking-[0.2em] uppercase border-b border-muted/30 pb-0.5 self-start">
                  Read Our Story →
                </button>
              </ScrollReveal>
            </div>
          </div>
        </div>
      </div>
    </section>);
}
const CATEGORY_TILES = [
    { id: 'hoodies', label: 'Hoodies', image: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=700&h=900&fit=crop&auto=format&q=80' },
    { id: 'tops', label: 'T-Shirts', image: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=700&h=900&fit=crop&auto=format&q=80' },
    { id: 'bottoms', label: 'Pants', image: 'https://images.unsplash.com/photo-1552902865-b72c031ac5ea?w=700&h=900&fit=crop&auto=format&q=80' },
    { id: 'outerwear', label: 'Outerwear', image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?w=700&h=900&fit=crop&auto=format&q=80' },
    { id: 'accessories', label: 'Accessories', image: 'https://images.unsplash.com/photo-1521369909029-2afed882baee?w=700&h=900&fit=crop&auto=format&q=80' },
];
// Not currently rendered on the homepage (see HomePage() below) — of these
// 5 categories, only Hoodies has real live products right now (see
// ShopPage.jsx's LIVE_CATEGORIES); linking to the other 4 would land a
// visitor on Shop's "Coming Soon" empty state, which reads as broken
// storefront chrome on a 3-product launch. Kept defined, not deleted, for
// when Urban Phoenix's catalog actually spans multiple live categories.
function ShopByCategory() {
    const { navigate, t } = useApp();
    return (<section className="py-24 lg:py-32 bg-bg">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-muted mb-2">Browse</p>
          <h2 className="font-display font-black uppercase text-fg leading-none mb-12" style={{ fontSize: 'clamp(2.5rem, 5vw, 5rem)', letterSpacing: '-0.015em' }}>
            Shop By Category
          </h2>
        </ScrollReveal>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 lg:gap-5">
          {CATEGORY_TILES.map((tile, i) => (<ScrollReveal key={tile.id} delay={i * 60}>
              <a
                href="/shop"
                onClick={(e) => { e.preventDefault(); navigate('shop', { category: tile.id }); }}
                className="relative block overflow-hidden bg-card group"
                style={{ aspectRatio: '3/4' }}
              >
                <img src={tile.image} onError={handleImgError} alt={tile.label} loading="lazy" decoding="async" className="up-photo absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"/>
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent"/>
                <div className="absolute inset-x-0 bottom-0 p-5">
                  <p className="font-display font-black uppercase text-white text-xl">{t(tile.label)}</p>
                </div>
              </a>
            </ScrollReveal>))}
        </div>
      </div>
    </section>);
}
// Not currently rendered on the homepage (see HomePage() below) — with only
// 3 total pieces, a dedicated "Now On Sale" section would just reshow
// whichever one of those 3 happens to be discounted, duplicating
// CollectionProducts above (whose cards already carry their own real sale
// badge). Kept defined, not deleted, for once a larger catalog makes a real
// standalone sale showcase worthwhile.
function SaleSpotlight() {
    const { navigate, products } = useApp();
    const saleProducts = getSaleProducts(products).slice(0, 4);
    if (saleProducts.length === 0) return null;
    return (<section className="py-24 lg:py-32 bg-card border-y border-border">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
        <div className="flex items-end justify-between mb-12">
          <ScrollReveal>
            <p className="text-[10px] font-mono tracking-[0.25em] uppercase text-accent-light mb-2">Limited Time</p>
            <h2 className="font-display font-black uppercase text-fg leading-none" style={{ fontSize: 'clamp(2.5rem, 5vw, 5rem)', letterSpacing: '-0.015em' }}>
              Now On Sale
            </h2>
          </ScrollReveal>
          <ScrollReveal>
            <button onClick={() => navigate('shop')} className="hidden lg:block text-[11px] font-mono tracking-[0.2em] uppercase text-muted hover:text-fg transition-colors border-b border-muted/40 pb-0.5">
              View All →
            </button>
          </ScrollReveal>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
          {saleProducts.map((product, i) => (<ScrollReveal key={product.id} delay={i * 80}>
              <ProductCard product={product}/>
            </ScrollReveal>))}
        </div>
      </div>
    </section>);
}
function InstagramGrid() {
    const { content, socialLinks } = useApp();
    const images = content.community?.images?.length ? content.community.images : [];
    if (images.length === 0) return null;
    return (<section className="py-24 lg:py-28 bg-bg">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="flex flex-col lg:flex-row items-start lg:items-end justify-between mb-10 gap-4">
            <div>
              <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-2">Community</p>
              <a href={socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="font-display font-black uppercase text-fg leading-none hover:text-accent-light transition-colors block" style={{ fontSize: 'clamp(2rem, 4vw, 4.5rem)', letterSpacing: '-0.015em' }}>
                @UrbanPhoenix
              </a>
            </div>
            <p className="text-sm font-body font-light text-muted">Tag us to be featured</p>
          </div>
        </ScrollReveal>

        <div className="grid grid-cols-3 lg:grid-cols-6 gap-1">
          {images.map((img, i) => (<ScrollReveal key={img.id} delay={i * 60}>
              <a href={img.link || socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="relative block overflow-hidden bg-card group cursor-pointer" style={{ aspectRatio: '1' }}>
                <img src={img.url} onError={handleImgError} alt="Urban Phoenix on Instagram" loading="lazy" decoding="async" className="w-full h-full up-photo object-cover transition-transform duration-500 group-hover:scale-105"/>
                <div className="absolute inset-0 bg-bg/0 group-hover:bg-bg/30 transition-colors duration-300 flex items-center justify-center">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
                    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
                    <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
                  </svg>
                </div>
              </a>
            </ScrollReveal>))}
        </div>
      </div>
    </section>);
}
function Newsletter() {
    const [email, setEmail] = useState('');
    const [submitted, setSubmitted] = useState(false);
    const [error, setError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!email || isSubmitting) return;
        setIsSubmitting(true);
        setError('');
        try {
            const res = await fetch('/api/newsletter/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Could not subscribe right now.');
            setSubmitted(true);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };
    return (<section className="py-28 lg:py-36 bg-card border-y border-border">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
        <ScrollReveal>
          <div className="max-w-2xl mx-auto text-center">
            <p className="text-[10px] font-mono text-muted tracking-[0.3em] uppercase mb-6">Early Access</p>
            <h2 className="font-display font-black uppercase text-fg leading-[0.9] mb-6" style={{ fontSize: 'clamp(3rem, 6vw, 7rem)', letterSpacing: '-0.02em' }}>
              Join The
              <br />
              Movement
            </h2>
            <p className="text-sm font-body font-light text-muted leading-relaxed mb-10">
              Be first for new drops, exclusive access, and unreleased campaign content.
            </p>

            {submitted ? (<div className="border border-accent px-8 py-5 inline-block">
                <p className="text-sm font-mono text-accent tracking-widest uppercase">
                  Welcome to Urban Phoenix.
                </p>
              </div>) : (<form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-0 max-w-md mx-auto">
                <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Your email address" required className="flex-1 bg-bg border border-border px-5 py-4 text-sm font-body text-fg placeholder:text-muted/50 focus:outline-none focus:border-accent transition-colors"/>
                <button type="submit" disabled={isSubmitting} className="bg-accent text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light transition-colors shrink-0 disabled:opacity-50">
                  {isSubmitting ? 'Subscribing…' : 'Subscribe'}
                </button>
              </form>)}
            {error && <p className="text-[11px] font-mono status-error mt-3">{error}</p>}
            <p className="text-[10px] font-mono text-muted mt-4 tracking-wide">
              No spam. Unsubscribe at any time.
            </p>
          </div>
        </ScrollReveal>
      </div>
    </section>);
}
// Order follows the intended homepage journey: hero → Collection 001 (the
// collection story) → the real 3 products → Limited Edition (only when a
// real product earns it) → brand philosophy → editorial → journal/community
// → newsletter. ShopByCategory and SaleSpotlight stay defined above but
// unmounted — see each one's own comment for why — and CollectionProducts/
// LimitedEditionSpotlight replace the old FeaturedProducts/MerchandisingBlock
// with versions driven by the real product catalog instead of a curated
// filter or hardcoded collection-wide claim.
export default function HomePage() {
    return (<main>
      <HeroSection />
      <TrustBar />
      <Marquee />
      <CollectionBanner />
      <CollectionProducts />
      <LimitedEditionSpotlight />
      <BrandStatement />
      <EditorialSection />
      <JournalTeaser />
      <InstagramGrid />
      <Newsletter />
    </main>);
}
