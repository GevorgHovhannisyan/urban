// Shared skeleton primitives. `Block` is the raw shimmering rectangle;
// everything else composes it into content-shaped placeholders so a loading
// state reads as "this page is arriving" rather than "this page is blank."
export function Block({ className = '', style }) {
  return <div className={`skeleton ${className}`} style={style} />;
}

export function ProductCardSkeleton() {
  return (
    <div>
      <Block className="w-full" style={{ aspectRatio: '3/4' }} />
      <div className="pt-3 space-y-2">
        <Block className="h-3 w-16" />
        <Block className="h-4 w-3/4" />
        <Block className="h-3 w-12" />
      </div>
    </div>
  );
}

// Grid-column count is expressed as static literal classNames (not a
// template-interpolated Tailwind class) — Tailwind's build-time scanner
// can't see through `grid-cols-${cols}`, so an interpolated class here would
// only work by coincidence if that exact class string happened to already
// be emitted from some other file.
const GRID_COLS_CLASS = { 2: 'lg:grid-cols-2', 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4' };

export function ProductGridSkeleton({ count = 8, cols = 4 }) {
  return (
    <div className={`grid grid-cols-2 ${GRID_COLS_CLASS[cols] || GRID_COLS_CLASS[4]} gap-4 lg:gap-5`}>
      {Array.from({ length: count }).map((_, i) => (
        <ProductCardSkeleton key={i} />
      ))}
    </div>
  );
}

// Route-level fallback (Suspense boundary in App.jsx) — can't know the exact
// shape of the page that's about to arrive, so this approximates the most
// common layout (a header block, then a few content rows) rather than
// leaving a blank screen during the brief moment a lazy chunk is fetched.
export function PageSkeleton() {
  return (
    <div className="min-h-screen pt-[var(--site-header-h,68px)] px-6 lg:px-12 py-12 max-w-screen-2xl mx-auto">
      <Block className="h-10 w-64 mb-3" />
      <Block className="h-4 w-40 mb-12" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
        {Array.from({ length: 8 }).map((_, i) => (
          <ProductCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function ListRowsSkeleton({ rows = 4 }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 items-center">
          <Block className="w-14 h-[72px] shrink-0" />
          <div className="flex-1 space-y-2">
            <Block className="h-3 w-1/3" />
            <Block className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function TextLinesSkeleton({ lines = 3, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Block key={i} className={`h-3 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}
