import { useApp } from '../context/AppContext';
import ProductCard from '../components/ProductCard';
import ScrollReveal from '../components/ScrollReveal';
import RevealImage from '../components/RevealImage';
import { FALLBACK_SRC } from '../utils/imageFallback';
import { ProductGridSkeleton } from '../components/Skeleton';
import ProductsUnavailable, { EmptyCatalog } from '../components/ProductsUnavailable';

// Renders a \n-separated headline (e.g. "Collection\n001") as its own
// stacked lines — the same convention content-api.mjs's homeBanner.headline
// already uses, kept consistent here rather than inventing a second markup
// scheme for multi-line CMS headlines.
function StackedLines({ text, accentClass }) {
  const lines = text.split('\n');
  return lines.map((line, i) => (
    <span key={i} className={i === lines.length - 1 ? accentClass : undefined}>
      {line}{i < lines.length - 1 && <br />}
    </span>
  ));
}

// A CTA "destination" is a closed set of real, safe pages this component
// itself resolves — never an Admin-typed URL/JS string (see
// content-api.mjs's CTA_DESTINATIONS, which enforces the same allowlist
// server-side on save). Unknown/blank values fall back to 'shop', the
// section's original hardcoded behavior.
const CTA_DESTINATIONS = { shop: 'shop', collection: 'collection', about: 'about', journal: 'journal' };

export default function CollectionPage() {
    const { navigate, products, productsStatus, content } = useApp();
    const collection = content.collection001;
    const teaser = content.collection002;
    // Real product count, never a hardcoded number — this is why "All N
    // Pieces" below always matches whatever the database actually returns
    // for Collection 001, not a stale/invented figure.
    const collectionProducts = products.filter(p => p.collection === 'Collection 001');
    const productsHeading = collection.productsHeadingMode === 'custom' && collection.productsHeadingCustom
      ? collection.productsHeadingCustom
      : (productsStatus === 'loading' ? 'Collection' : `All ${collectionProducts.length} Pieces`);
    return (<main className="bg-bg min-h-screen">
      {/* 01 — Hero */}
      {collection.heroEnabled && (
        <section className="relative h-screen min-h-[600px] flex items-end overflow-hidden">
          {/* A dedicated mobile crop is optional (Admin → Site Content →
              Collections → Collection 001 → 01 Hero) — <picture>'s
              media-query source only ever swaps which single image the
              browser downloads, and falls back to the desktop image below
              whenever no mobile image has been set, so this never shows a
              broken image on small screens. */}
          <picture className="absolute inset-0">
            {collection.heroMobileImageUrl && <source media="(max-width: 767px)" srcSet={collection.heroMobileImageUrl} />}
            <RevealImage src={collection.heroImageUrl} alt={collection.heroImageAlt || ''} fetchPriority="high" wrapperClassName="absolute inset-0" className="w-full h-full object-cover up-photo"/>
          </picture>
          {/* Literal black/white, not bg-bg/text-fg: this scrim and headline
              sit on top of photography, not page chrome, so they must not
              flip with the theme. Part of the fixed page design, never part
              of an uploaded image. */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-transparent"/>
          <div className="absolute inset-0 bg-black/20"/>

          <div className="relative z-10 w-full max-w-screen-2xl mx-auto px-6 lg:px-12 pb-20 lg:pb-28">
            <p className="text-[10px] font-mono text-white/70 tracking-[0.35em] uppercase mb-6 hero-label">
              {collection.heroLabel}
            </p>
            <h1 className="font-display font-black uppercase text-white leading-[0.88] hero-title" style={{ fontSize: 'clamp(5rem, 13vw, 14rem)', letterSpacing: '-0.02em' }}>
              <StackedLines text={collection.heroHeadline} accentClass="text-white/70" />
            </h1>
            <div className="flex flex-col lg:flex-row items-start lg:items-end gap-6 mt-8 hero-cta">
              <p className="text-sm font-body font-light text-white/70 max-w-sm leading-relaxed">
                {collection.heroSub}
              </p>
              {collection.heroCtaLabel && (
                <button onClick={() => navigate(CTA_DESTINATIONS[collection.heroCtaDestination] || 'shop')} className="border border-white/30 text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-white/10 transition-colors shrink-0">
                  {collection.heroCtaLabel}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* 02 — The Story — the heading pins in place (lg:sticky) while the
          long-form copy beside it scrolls past, so the story headline reads
          as a held editorial statement rather than just more text that
          scrolls off with everything else. */}
      {collection.storyEnabled && (
        <section className="py-24 lg:py-32 max-w-screen-2xl mx-auto px-6 lg:px-12">
          <div className="grid lg:grid-cols-12 gap-12 items-start">
            <div className="lg:col-span-5 lg:sticky lg:top-[calc(var(--site-header-h,68px)+40px)]">
              <ScrollReveal>
                <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-6">{collection.storyEyebrow}</p>
                <h2 className="font-display font-black uppercase text-fg leading-[0.9]" style={{ fontSize: 'clamp(3rem, 5vw, 5.5rem)', letterSpacing: '-0.015em' }}>
                  <StackedLines text={collection.storyHeadline} accentClass="text-accent" />
                </h2>
              </ScrollReveal>
            </div>
            <div className="lg:col-span-7 lg:pt-16">
              <ScrollReveal delay={100}>
                {collection.storyBody.split('\n\n').filter(Boolean).map((paragraph, i) => (
                  <p key={i} className="text-base font-body font-light text-muted leading-loose mb-6 last:mb-0">
                    {paragraph}
                  </p>
                ))}
              </ScrollReveal>
            </div>
          </div>
        </section>
      )}

      {/* 03 — Products — editorial framing (eyebrow/heading) is CMS-driven;
          the product cards themselves always come straight from the real
          catalog (products.filter above), the exact same live data Shop
          uses — never a static/CMS-authored card. */}
      {collection.productsEnabled && (
        <section className="py-20 max-w-screen-2xl mx-auto px-6 lg:px-12">
          <ScrollReveal>
            <div className="flex items-end justify-between mb-12">
              <div>
                <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-2">{collection.productsEyebrow}</p>
                <h2 className="font-display font-black uppercase text-fg leading-none" style={{ fontSize: 'clamp(2.5rem, 5vw, 5rem)', letterSpacing: '-0.015em' }}>
                  {productsHeading}
                </h2>
              </div>
            </div>
          </ScrollReveal>
          {productsStatus === 'loading' ? (
            <ProductGridSkeleton count={3} cols={3} />
          ) : productsStatus === 'error' ? (
            <ProductsUnavailable />
          ) : collectionProducts.length === 0 ? (
            <EmptyCatalog />
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 lg:gap-5">
              {collectionProducts.map((product, i) => (<ScrollReveal key={product.id} delay={i * 60}>
                  <ProductCard product={product}/>
                </ScrollReveal>))}
            </div>
          )}
        </section>
      )}

      {/* 04 — Next Collection Teaser — editorial only (see content-api.mjs's
          collection002 comment): never activates Collection 002 commerce,
          which is decided entirely by real product rows/dates. */}
      {teaser.enabled && (
        <section className="relative h-[50vh] min-h-[360px] overflow-hidden">
          <picture className="absolute inset-0">
            {teaser.mobileImageUrl && <source media="(max-width: 767px)" srcSet={teaser.mobileImageUrl} />}
            <RevealImage src={teaser.imageUrl || FALLBACK_SRC} alt={teaser.imageAlt || ''} loading="lazy" decoding="async" wrapperClassName="absolute inset-0" className="w-full h-full object-cover up-photo"/>
          </picture>
          <div className="absolute inset-0 bg-bg/70"/>
          <div className="relative z-10 h-full flex items-center justify-center text-center px-6">
            <ScrollReveal>
              <p className="text-[10px] font-mono text-muted tracking-[0.35em] uppercase mb-4">{teaser.eyebrow}</p>
              <h2 className="font-display font-black uppercase text-fg leading-[0.9]" style={{ fontSize: 'clamp(3rem, 7vw, 8rem)', letterSpacing: '-0.02em' }}>
                <StackedLines text={teaser.headline} accentClass="text-muted/50" />
              </h2>
              {teaser.ctaEnabled && teaser.ctaLabel && (
                <button onClick={() => navigate(CTA_DESTINATIONS[teaser.ctaDestination] || 'shop')} className="mt-8 border border-fg/30 text-fg px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-[var(--hover-overlay)] transition-colors">
                  {teaser.ctaLabel}
                </button>
              )}
            </ScrollReveal>
          </div>
        </section>
      )}
    </main>);
}
