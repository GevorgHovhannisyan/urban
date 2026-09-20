import { useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import ProductCard from '../components/ProductCard';
import ScrollReveal from '../components/ScrollReveal';
import CategoryComingSoon from '../components/CategoryComingSoon';
import { CATEGORIES, CATEGORY_LABELS } from '../components/MegaMenu';
import { useApp } from '../context/AppContext';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { ProductGridSkeleton } from '../components/Skeleton';
import ProductsUnavailable, { EmptyCatalog } from '../components/ProductsUnavailable';
// Urban Phoenix currently only sells hoodies — this is an explicit,
// deliberate, temporary restriction per current business direction, not
// something derived from product data (the catalog/seed data can carry
// items in other categories for testing/future-drop purposes well before
// they're real, live, purchasable inventory). Update this list the moment a
// new category is actually for sale — availableCategories (below, in the
// component) still ANDs this against real product data, so a listed
// category with zero live products still won't show an empty pill.
const LIVE_CATEGORIES = ['hoodies'];
// Canonical vocab + display order for sizes/colors — NOT the source of truth
// for what's shown. availableSizes/availableColors (below, in the component)
// filter these down to values actually present on a real product, and
// append anything present in the data but not yet listed here so a brand-
// new size/color already on a product is never silently hidden. A facet
// only renders at all once it has more than one real option — see
// showSizeFacet/showColorFacet below.
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];
const COLORS = ['Black', 'Chalk', 'Slate', 'Charcoal', 'Ash', 'Sand', 'Cream', 'Off White'];
// Collection headline tagline shown under "Shop" (e.g. "COLLECTION 001 —
// FREEDOM TO BECOME") — purely presentational marketing copy, not filter
// logic. Add an entry once a future collection's tagline is confirmed;
// an unmapped collection name still displays fine on its own, just without
// a dash-tagline.
const COLLECTION_TAGLINES = {
    'Collection 001': 'Freedom To Become',
};
const COLOR_SWATCHES = {
    Black: '#0a0a0a',
    Chalk: '#e8e6e1',
    Slate: '#5c6670',
    Charcoal: '#333333',
    Ash: '#8a8a85',
    Sand: '#c8b89a',
    Cream: '#efe6d5',
    'Off White': '#f2f0ea',
};
const SORT_OPTIONS = [
    { label: 'Featured', value: 'featured' },
    { label: 'Price: Low to High', value: 'price-asc' },
    { label: 'Price: High to Low', value: 'price-desc' },
    { label: "New Arrivals", value: 'new' },
];
// Standard vs. compact/dense — column counts per breakpoint, not a raw
// number, so mobile gets its own (smaller) pair of densities instead of
// reusing desktop's.
const VIEW_MODES = [
    { value: 'grid', label: 'Grid view', mobileCols: 2, desktopCols: 3, bars: 3 },
    { value: 'compact', label: 'Compact view', mobileCols: 3, desktopCols: 4, bars: 5 },
];
const DEFAULT_FILTERS = {
    categories: [],
    sizes: [],
    colors: [],
    collections: [],
    availability: 'all',
    onSale: false,
};
// "3 Pieces" / "1 Piece" / "0 Pieces" — the singular/plural grammar the
// editorial header and toolbar count both need, from a real number, never
// a hardcoded string.
const pieceLabel = (n) => `${n} ${n === 1 ? 'Piece' : 'Pieces'}`;

// Shared label + pill-row wrapper used by both the mobile filter sheet and
// the desktop inline panel below, so a facet's markup exists in one place —
// only which facets get rendered (and their outer spacing) differs between
// the two layouts.
function FacetGroup({ label, children, className = '' }) {
    return (<div className={className}>
      <p className="text-[10px] font-mono text-fg/80 tracking-[0.2em] uppercase mb-3 lg:mb-4 pb-2 border-b border-border">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>);
}

// canonical: the fixed vocab/display order (e.g. SIZES, COLORS above).
// values: every value actually present across live products (may contain
// duplicates/gaps). Returns canonical-ordered present values, then any
// present value canonical doesn't know about yet (sorted), so a real value
// is never dropped just because it's missing from the canonical list.
function presentValues(canonical, values) {
    const present = new Set(values.filter(Boolean));
    const ordered = canonical.filter((v) => present.has(v));
    const extras = [...present].filter((v) => !canonical.includes(v)).sort();
    return [...ordered, ...extras];
}

function FilterPill({ label, active, onClick, swatch }) {
    return (<button
        onClick={onClick}
        aria-pressed={active}
        className={`group/pill relative flex items-center gap-2 text-[10px] font-mono tracking-[0.15em] uppercase px-3.5 py-2 border transition-all duration-150 ${active
            ? 'bg-accent border-accent text-white shadow-[0_0_0_1px_rgba(198,93,30,0.4)]'
            : 'border-border text-muted hover:border-[var(--text-secondary)] hover:text-fg hover:bg-[var(--hover-overlay)]'}`}
      >
        {swatch && (
          <span
            aria-hidden="true"
            className={`inline-block w-3 h-3 rounded-full border transition-colors ${active ? 'border-white/60' : 'border-white/25 group-hover/pill:border-white/50'}`}
            style={{ backgroundColor: swatch }}
          />
        )}
        {label}
      </button>);
}

// Custom-built dropdown rather than a native <select> — once opened, a native
// select's option list is rendered entirely by the OS/browser (plain white
// background, system font, blue highlight) and can't be themed with CSS,
// which broke the dark aesthetic everywhere else on this bar. Follows the
// same open/outside-click/escape pattern already used by Navbar's HeaderSelect.
function SortDropdown({ value, options, onChange }) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef(null);
    const selected = options.find(opt => opt.value === value) || options[0];

    useEffect(() => {
        const close = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', close);
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', close);
            document.removeEventListener('keydown', onKey);
        };
    }, []);

    return (
        <div className="relative" ref={rootRef}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-haspopup="listbox"
                aria-expanded={open}
                className={`flex items-center gap-6 text-[10px] font-mono tracking-[0.18em] uppercase pl-4 pr-3.5 py-3 border transition-colors duration-200 ${open
                    ? 'border-accent text-fg'
                    : 'border-border text-fg hover:border-[var(--text-secondary)]'}`}
            >
                <span key={value}>{selected.label}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`text-muted transition-transform duration-300 ${open ? 'rotate-180' : ''}`} aria-hidden="true">
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>
            {open && (
                <div role="listbox" className="absolute right-0 top-full mt-2 w-56 bg-surface border border-border shadow-2xl shadow-black/60 overflow-hidden z-50">
                    {options.map(opt => (
                        <button
                            key={opt.value}
                            role="option"
                            aria-selected={opt.value === value}
                            onClick={() => { onChange(opt.value); setOpen(false); }}
                            className={`w-full flex items-center justify-between gap-4 text-left text-[10px] font-mono tracking-[0.15em] uppercase px-5 py-3 transition-colors duration-150 ${opt.value === value
                                ? 'text-accent bg-accent/[0.08]'
                                : 'text-muted hover:text-fg hover:bg-[var(--hover-overlay)]'}`}
                        >
                            {opt.label}
                            {opt.value === value && (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <polyline points="20 6 9 17 4 12" />
                                </svg>
                            )}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// Two-option density switcher — thin-border segmented control, solid accent
// fill on the active option (no glow/shadow), subtle hover on the inactive
// one. Visible at every breakpoint now (both ShopPage grids — mobile and
// desktop — derive their column count from `value`, so the control always
// does something wherever it's shown).
function ViewSwitcher({ value, onChange }) {
    return (
        <div role="group" aria-label="Grid density" className="flex items-center border border-border">
            {VIEW_MODES.map((mode, i) => {
                const active = value === mode.value;
                return (
                    <button
                        key={mode.value}
                        type="button"
                        onClick={() => onChange(mode.value)}
                        aria-pressed={active}
                        aria-label={mode.label}
                        className={`flex items-center justify-center w-10 h-10 transition-colors duration-200 ${i > 0 ? 'border-l border-border' : ''} ${active
                            ? 'bg-accent text-white'
                            : 'text-muted hover:text-fg hover:bg-[var(--hover-overlay)]'}`}
                    >
                        <div className="flex gap-[3px] items-center" aria-hidden="true">
                            {Array.from({ length: mode.bars }).map((_, barIndex) => (
                                <div key={barIndex} className="w-[2.5px] h-3 bg-current rounded-[1px]" />
                            ))}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

export default function ShopPage() {
    const { products, productsStatus, pageData } = useApp();
    // Footer category links and the header mega-menu both navigate here with
    // { category: 'tops' } etc — seed the filter from it so those links
    // actually filter instead of silently landing on the unfiltered grid.
    const [filters, setFilters] = useState(() => (
        pageData?.category ? { ...DEFAULT_FILTERS, categories: [pageData.category] } : DEFAULT_FILTERS
    ));
    // ShopPage doesn't remount on repeat "shop" navigations (App.jsx keys the
    // page div by page name, not by pageData), so a second category click
    // while already here needs this to actually take effect.
    useEffect(() => {
        if (pageData?.category) setFilters((prev) => ({ ...prev, categories: [pageData.category] }));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageData?.category]);
    const [sort, setSort] = useState('featured');
    const [filtersOpen, setFiltersOpen] = useState(false);
    // Two densities only — 'grid' (standard) and 'compact' (dense) — see
    // VIEW_MODES below. Column counts per breakpoint are derived from this,
    // not stored separately, so mobile and desktop can never disagree about
    // which density is active.
    const [viewMode, setViewMode] = useState('grid');
    const activeViewMode = VIEW_MODES.find(m => m.value === viewMode) || VIEW_MODES[0];
    // A brief opacity dip whenever density changes — CSS can't meaningfully
    // animate a grid going from N tracks to a different number of tracks
    // (browsers just snap), so this is what actually delivers the "smooth
    // transition when changing grid density" instead: a quick 250ms fade
    // rather than an instant re-flow. Product cards themselves (and their
    // own ScrollReveal mount animation) are untouched by this.
    const [densitySettling, setDensitySettling] = useState(false);
    const isFirstDensityRender = useRef(true);
    useEffect(() => {
        if (isFirstDensityRender.current) { isFirstDensityRender.current = false; return; }
        setDensitySettling(true);
        const t = setTimeout(() => setDensitySettling(false), 250);
        return () => clearTimeout(t);
    }, [viewMode]);
    const [isMobile, setIsMobile] = useState(false);
    const filterPanelRef = useRef(null);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 1023px)');
        const update = () => setIsMobile(mq.matches);
        update();
        mq.addEventListener('change', update);
        return () => mq.removeEventListener('change', update);
    }, []);
    // On mobile, filters become a full-screen sheet (scroll-locked, focus-trapped,
    // Escape-to-close) — the desktop inline reveal has room to just push content
    // down, but on a small screen a long filter list needs its own scroll region.
    useDialogBehavior(filtersOpen && isMobile, () => setFiltersOpen(false), filterPanelRef);
    const toggle = (key, value) => {
        setFilters(prev => {
            const arr = prev[key];
            return {
                ...prev,
                [key]: arr.includes(value) ? arr.filter(v => v !== value) : [...arr, value],
            };
        });
    };
    const clearAll = () => setFilters(DEFAULT_FILTERS);
    const filtered = useMemo(() => {
        let list = [...products];
        if (filters.categories.length) {
            list = list.filter(p => filters.categories.includes(p.category));
        }
        if (filters.sizes.length) {
            list = list.filter(p => p.sizes.some(s => filters.sizes.includes(s)));
        }
        if (filters.colors.length) {
            list = list.filter(p => p.colors.some(c => filters.colors.includes(c)));
        }
        if (filters.collections.length) {
            list = list.filter(p => filters.collections.includes(p.collection));
        }
        if (filters.availability === 'in-stock') {
            list = list.filter(p => !p.isSoldOut);
        }
        if (filters.onSale) {
            list = list.filter(p => Number(p.compareAtPrice) > Number(p.price));
        }
        if (sort === 'price-asc')
            list.sort((a, b) => a.price - b.price);
        else if (sort === 'price-desc')
            list.sort((a, b) => b.price - a.price);
        else if (sort === 'new')
            list.sort((a, b) => (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0));
        return list;
    }, [filters, sort, products]);
    // Never render more grid columns than there are pieces to fill them —
    // see the comment at the grid render below for why.
    const mobileCols = Math.max(1, Math.min(activeViewMode.mobileCols, filtered.length || activeViewMode.mobileCols));
    const desktopCols = Math.max(1, Math.min(activeViewMode.desktopCols, filtered.length || activeViewMode.desktopCols));
    // Only offer categories that actually have live products right now
    // (today, that's just Hoodies) — an empty category tab/pill is a dead
    // end for a shopper and implies stock that doesn't exist. This is
    // computed from real product data, not hardcoded, so it fills back in
    // on its own the moment T-Shirts/Outerwear/Accessories get real items.
    const availableCategories = useMemo(
        () => CATEGORIES.filter(id => LIVE_CATEGORIES.includes(id) && products.some(p => p.category === id)),
        [products]
    );
    // Every other facet's options, the same way: derived from what's actually
    // on a live product right now, never a static list — see presentValues()
    // above and the SIZES/COLORS comment. Sourced from the full catalog
    // (`products`), not the currently-filtered `filtered` list, so choosing
    // one filter never makes an unrelated facet's own options disappear.
    const availableSizes = useMemo(
        () => presentValues(SIZES, products.flatMap(p => p.sizes || [])),
        [products]
    );
    const availableColors = useMemo(
        () => presentValues(COLORS, products.flatMap(p => p.colors || [])),
        [products]
    );
    const availableCollections = useMemo(
        () => [...new Set(products.map(p => p.collection).filter(Boolean))].sort(),
        [products]
    );
    const hasSoldOutProduct = products.some(p => p.isSoldOut);
    const hasInStockProduct = products.some(p => !p.isSoldOut);
    const hasSaleProduct = products.some(p => Number(p.compareAtPrice) > Number(p.price));
    // A facet earns its place in the UI only once it can actually narrow the
    // result set — one option (or zero) is never a real choice. This is why,
    // right now, with Collection 001's 3 pieces all in one category/collection
    // and none sized/colored/sale-tagged/sold-out yet, none of these are
    // true and the whole Filter control disappears (see hasAnyMeaningfulFacet
    // below) — the moment a second category, color, size, sale item or
    // sold-out piece exists for real, its facet reappears on its own.
    const showCategoryFacet = availableCategories.length > 1;
    const showSizeFacet = availableSizes.length > 1;
    const showColorFacet = availableColors.length > 1;
    const showCollectionFacet = availableCollections.length > 1;
    const showAvailabilityFacet = hasSoldOutProduct && hasInStockProduct;
    const showSaleFacet = hasSaleProduct;
    const hasAnyMeaningfulFacet = showCategoryFacet || showSizeFacet || showColorFacet
        || showCollectionFacet || showAvailabilityFacet || showSaleFacet;
    // Collection headline under "Shop" (e.g. "COLLECTION 001 — FREEDOM TO
    // BECOME") — only shown when the catalog is a single, named collection;
    // once a second collection is live there's no one honest headline to
    // show here, so it's dropped rather than guessed.
    const collectionHeadline = availableCollections.length === 1
        ? [availableCollections[0].toUpperCase(), COLLECTION_TAGLINES[availableCollections[0]]?.toUpperCase()].filter(Boolean).join(' — ')
        : null;
    const activeFilterCount = filters.categories.length + filters.sizes.length + filters.colors.length + filters.collections.length + (filters.onSale ? 1 : 0);
    // Distinguishes "you filtered yourself into zero results" (show Clear
    // Filters) from "this whole category has no live products yet" (show
    // the branded coming-soon state) — only the latter applies when exactly
    // one category is selected with no other filters narrowing it further,
    // and that category has zero products regardless of any other facet.
    const soleEmptyCategory = filters.categories.length === 1
        && filters.sizes.length === 0 && filters.colors.length === 0 && filters.collections.length === 0
        && filters.availability === 'all' && !filters.onSale
        && !products.some(p => p.category === filters.categories[0])
        ? filters.categories[0]
        : null;
    return (<main className="bg-bg min-h-screen pt-[var(--site-header-h,68px)]">
      {/* Page header — editorial, not a generic "All Products" catalog
          banner: name the collection actually being shown, and let the
          piece count come straight from the real product total (never
          hardcoded), so it stays honest whether that's 3 pieces today or
          8 once more drops land. */}
      <div className="border-b border-border px-6 lg:px-12 py-14 lg:py-20 max-w-screen-2xl mx-auto">
        <h1 className="font-display font-black uppercase text-fg leading-none mb-4" style={{ fontSize: 'clamp(3rem, 6vw, 6rem)', letterSpacing: '-0.02em' }}>
          Shop
        </h1>
        {collectionHeadline && (
          <p className="text-[10px] font-mono text-muted tracking-[0.3em] uppercase mb-2">{collectionHeadline}</p>
        )}
        {productsStatus !== 'loading' && (
          <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase">{pieceLabel(products.length)}</p>
        )}
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12">
        {/* Toolbar — one row on desktop (Filter | count · sort · view), two
            rows on mobile (Filter+Clear / Sort, then count + view) so
            nothing overflows horizontally on a small screen. */}
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 py-5 border-b border-border">
          <div className="flex items-center justify-between gap-4 lg:justify-start">
            <div className="flex items-center gap-4">
              {/* The Filter control itself only exists once at least one facet
                  below can actually narrow the catalog — see
                  hasAnyMeaningfulFacet. With today's 3-piece, single-category,
                  single-collection launch catalog that's false, so this whole
                  cluster (and Clear All) is absent rather than opening onto a
                  panel with nothing useful in it. */}
              {hasAnyMeaningfulFacet && (<>
                <button onClick={() => setFiltersOpen(!filtersOpen)} className={`group flex items-center gap-2.5 text-[10px] font-mono tracking-[0.2em] uppercase px-5 py-3 border transition-colors duration-200 ${filtersOpen || activeFilterCount > 0
                ? 'border-accent text-accent'
                : 'border-border text-muted hover:text-fg hover:border-[var(--text-secondary)]'}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="transition-transform duration-300 group-hover:rotate-90" aria-hidden="true">
                    <line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2.3" fill="currentColor" stroke="none" />
                    <line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2.3" fill="currentColor" stroke="none" />
                  </svg>
                  <span key={activeFilterCount}>Filter {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}</span>
                </button>
                {activeFilterCount > 0 && (<button onClick={clearAll} className="text-[10px] font-mono tracking-[0.15em] uppercase text-muted hover:text-accent transition-colors duration-200 underline underline-offset-4 decoration-border hover:decoration-accent">
                    Clear All
                  </button>)}
              </>)}
            </div>
            {/* Sort lives here (next to Filter) only on mobile — on desktop
                it moves into the right-hand cluster below. Both instances
                are controlled by the same `sort` state. */}
            <div className="lg:hidden">
              <SortDropdown value={sort} options={SORT_OPTIONS} onChange={setSort} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4 lg:justify-end lg:gap-6">
            <span key={filtered.length} className="text-[10px] font-mono tracking-[0.1em]">
              {productsStatus === 'loading' ? <><strong className="text-fg font-semibold">—</strong> <span className="text-muted">Pieces</span></> : <span className="text-fg font-semibold">{pieceLabel(filtered.length)}</span>}
            </span>
            <div className="hidden lg:block">
              <SortDropdown value={sort} options={SORT_OPTIONS} onChange={setSort} />
            </div>
            <ViewSwitcher value={viewMode} onChange={setViewMode} />
          </div>
        </div>

        {/* Filter panel — inline reveal on desktop, full-screen sheet on mobile.
            The mobile sheet is portaled to <body>: this page renders inside
            App.jsx's `.page-transition` wrapper, whose fade animation leaves a
            `transform` on that ancestor after it finishes (animation-fill-mode:
            both) — that makes it a new containing block for any descendant
            `position: fixed` element, breaking naive fixed-sheet positioning.
            A portal escapes that ancestor so the sheet is truly viewport-fixed. */}
        {filtersOpen && hasAnyMeaningfulFacet && (isMobile ? createPortal(<>
          <button className="fixed inset-0 z-[299] bg-[var(--overlay-scrim)] backdrop-blur-sm border-0" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />
          <div
            ref={filterPanelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Filters"
            className="quick-add-sheet fixed inset-x-0 bottom-0 top-16 z-[300] bg-bg overflow-y-auto p-6 pb-28 grid grid-cols-2 gap-6 content-start">
            {isMobile && (
              <div className="col-span-2 flex items-center justify-between -mt-1 mb-2 pb-4 border-b border-border">
                <p className="font-display font-black uppercase text-xl">Filters</p>
                <button onClick={() => setFiltersOpen(false)} aria-label="Close" className="w-9 h-9 flex items-center justify-center border border-border">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                </button>
              </div>
            )}
            {/* Only facets with more than one real option render at all — see
                showCategoryFacet/showSizeFacet/etc above. */}
            {showCategoryFacet && (
              <FacetGroup label="Category">
                {availableCategories.map(id => (<FilterPill key={id} label={CATEGORY_LABELS[id]} active={filters.categories.includes(id)} onClick={() => toggle('categories', id)}/>))}
              </FacetGroup>
            )}
            {showSizeFacet && (
              <FacetGroup label="Size">
                {availableSizes.map(s => (<FilterPill key={s} label={s} active={filters.sizes.includes(s)} onClick={() => toggle('sizes', s)}/>))}
              </FacetGroup>
            )}
            {showColorFacet && (
              <FacetGroup label="Colour" className="col-span-2">
                {availableColors.map(c => (<FilterPill key={c} label={c} swatch={COLOR_SWATCHES[c]} active={filters.colors.includes(c)} onClick={() => toggle('colors', c)}/>))}
              </FacetGroup>
            )}
            {showCollectionFacet && (
              <FacetGroup label="Collection">
                {availableCollections.map(c => (<FilterPill key={c} label={c} active={filters.collections.includes(c)} onClick={() => toggle('collections', c)}/>))}
              </FacetGroup>
            )}
            {showAvailabilityFacet && (
              <FacetGroup label="Availability">
                <FilterPill label="All" active={filters.availability === 'all'} onClick={() => setFilters(f => ({ ...f, availability: 'all' }))}/>
                <FilterPill label="In Stock" active={filters.availability === 'in-stock'} onClick={() => setFilters(f => ({ ...f, availability: 'in-stock' }))}/>
              </FacetGroup>
            )}
            {showSaleFacet && (
              <FacetGroup label="Price">
                <FilterPill label="Sale" active={filters.onSale} onClick={() => setFilters(f => ({ ...f, onSale: !f.onSale }))}/>
              </FacetGroup>
            )}

            <div className="col-span-2 fixed inset-x-0 bottom-0 p-4 bg-bg border-t border-border flex gap-3">
              {activeFilterCount > 0 && (
                <button onClick={clearAll} className="flex-1 border border-border py-3.5 text-[11px] font-mono uppercase tracking-widest">
                  Clear All
                </button>
              )}
              {/* key={filtered.length}: plain text-content updates on this
                  button were silently failing to commit to the DOM even
                  though render computed the correct count every time —
                  forcing a remount (instead of an update) when the count
                  changes sidesteps whatever causes that. */}
              <button key={filtered.length} onClick={() => setFiltersOpen(false)} className="flex-1 btn-primary py-3.5 text-[11px] font-mono uppercase tracking-widest">
                Show {filtered.length} Results
              </button>
            </div>
          </div>
        </>, document.body) : (
          <div className="border-b border-border bg-[var(--hover-overlay)] px-8 py-10 flex flex-wrap gap-x-10 gap-y-8 lg:divide-x lg:divide-border">
            {showCategoryFacet && (
              <FacetGroup label="Category" className="min-w-[160px] lg:pl-8 lg:first:pl-0">
                {availableCategories.map(id => (<FilterPill key={id} label={CATEGORY_LABELS[id]} active={filters.categories.includes(id)} onClick={() => toggle('categories', id)}/>))}
              </FacetGroup>
            )}
            {showSizeFacet && (
              <FacetGroup label="Size" className="min-w-[160px] lg:pl-8 lg:first:pl-0">
                {availableSizes.map(s => (<FilterPill key={s} label={s} active={filters.sizes.includes(s)} onClick={() => toggle('sizes', s)}/>))}
              </FacetGroup>
            )}
            {showColorFacet && (
              <FacetGroup label="Colour" className="min-w-[220px] lg:pl-8 lg:first:pl-0">
                {availableColors.map(c => (<FilterPill key={c} label={c} swatch={COLOR_SWATCHES[c]} active={filters.colors.includes(c)} onClick={() => toggle('colors', c)}/>))}
              </FacetGroup>
            )}
            {showCollectionFacet && (
              <FacetGroup label="Collection" className="min-w-[160px] lg:pl-8 lg:first:pl-0">
                {availableCollections.map(c => (<FilterPill key={c} label={c} active={filters.collections.includes(c)} onClick={() => toggle('collections', c)}/>))}
              </FacetGroup>
            )}
            {showAvailabilityFacet && (
              <FacetGroup label="Availability" className="min-w-[160px] lg:pl-8 lg:first:pl-0">
                <FilterPill label="All" active={filters.availability === 'all'} onClick={() => setFilters(f => ({ ...f, availability: 'all' }))}/>
                <FilterPill label="In Stock" active={filters.availability === 'in-stock'} onClick={() => setFilters(f => ({ ...f, availability: 'in-stock' }))}/>
              </FacetGroup>
            )}
            {showSaleFacet && (
              <FacetGroup label="Price" className="min-w-[160px] lg:pl-8 lg:first:pl-0">
                <FilterPill label="Sale" active={filters.onSale} onClick={() => setFilters(f => ({ ...f, onSale: !f.onSale }))}/>
              </FacetGroup>
            )}
          </div>
        ))}

        {/* Product grid */}
        <div className="py-8">
          {productsStatus === 'loading' ? (
            <ProductGridSkeleton count={6} cols={activeViewMode.desktopCols} />
          ) : productsStatus === 'error' ? (
            <ProductsUnavailable />
          ) : products.length === 0 ? (
            <EmptyCatalog message="No Pieces Available" />
          ) : filtered.length === 0 && soleEmptyCategory ? (
            <CategoryComingSoon
              categoryLabel={CATEGORY_LABELS[soleEmptyCategory]}
              onShopHoodies={() => setFilters({ ...DEFAULT_FILTERS, categories: ['hoodies'] })}
            />
          ) : filtered.length === 0 ? (
            // Distinct from ProductsUnavailable/EmptyCatalog above: the
            // catalog loaded fine, these are just the results of the
            // customer's own filter choices — Clear Filters undoes exactly
            // that, it isn't a retry/reload action.
            <div className="py-24 text-center">
              <p className="font-display font-black uppercase text-2xl md:text-3xl tracking-tight text-fg mb-3">No Pieces Found</p>
              <p className="text-sm font-body text-muted mb-8">Try adjusting your filters.</p>
              <button onClick={clearAll} className="border border-border text-fg px-8 py-3.5 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-[var(--hover-overlay)] transition-colors">
                Clear Filters
              </button>
            </div>
          ) : (<>
              {/* Column count never exceeds how many pieces are actually being
                  shown — 3 real products in a 4-up "Compact" density (or any
                  view mode) would otherwise leave one hollow, unbalanced gap
                  in the row instead of reading as a deliberate 3-up layout.
                  Once the catalog grows past a view mode's normal column
                  count, this clamp stops doing anything and that view mode's
                  real density takes over. */}
              <div
                className={`grid gap-4 lg:gap-5 lg:hidden transition-opacity duration-200 ${densitySettling ? 'opacity-60' : 'opacity-100'} ${mobileCols === 1 ? 'max-w-sm mx-auto' : ''}`}
                style={{ gridTemplateColumns: `repeat(${mobileCols}, minmax(0, 1fr))` }}
              >
                {filtered.map((product, i) => (<ScrollReveal key={product.id} delay={(i % mobileCols) * 60}><ProductCard product={product}/></ScrollReveal>))}
              </div>
              <div
                className={`hidden lg:grid gap-5 transition-opacity duration-200 ${densitySettling ? 'opacity-60' : 'opacity-100'} ${desktopCols <= 2 ? 'max-w-3xl mx-auto' : ''}`}
                style={{ gridTemplateColumns: `repeat(${desktopCols}, minmax(0, 1fr))` }}
              >
                {filtered.map((product, i) => (<ScrollReveal key={product.id} delay={(i % desktopCols) * 60}><ProductCard product={product}/></ScrollReveal>))}
              </div>
            </>)}
        </div>
      </div>
    </main>);
}
