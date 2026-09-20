import { useApp } from '../context/AppContext';

// Shown wherever a page depends on the real product catalog and the
// /api/products request itself failed — never rendered in place of a
// genuinely empty catalog (see EmptyCatalog, the sibling state) and never a
// reason to fall back to any static/demo product data.
export default function ProductsUnavailable({ className = '' }) {
  const { retryLoadProducts } = useApp();
  return (
    <div className={`text-center py-24 px-6 ${className}`} role="alert">
      <p className="font-display font-black uppercase text-2xl md:text-3xl tracking-tight text-fg mb-3">
        Products Temporarily Unavailable
      </p>
      <p className="text-sm text-muted mb-8">Please try again.</p>
      <button
        onClick={retryLoadProducts}
        className="border border-border text-fg px-8 py-3.5 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-[var(--hover-overlay)] transition-colors"
      >
        Retry
      </button>
    </div>
  );
}

// The catalog request succeeded but genuinely has nothing to show — a
// distinct state from ProductsUnavailable above, never merged into it.
export function EmptyCatalog({ message = 'No Products Available', className = '' }) {
  return (
    <div className={`text-center py-24 px-6 ${className}`}>
      <p className="font-display font-black uppercase text-2xl md:text-3xl tracking-tight text-fg">
        {message}
      </p>
    </div>
  );
}
