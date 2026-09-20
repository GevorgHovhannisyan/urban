import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp, pageToPath } from '../context/AppContext';
import { handleImgError } from '../utils/imageFallback';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { useExitAnimation } from '../hooks/useExitAnimation';

const POPULAR_SEARCHES = ['Hoodie', 'Cargo Pant', 'Bomber', 'Tee', 'Limited Edition'];

export default function SearchOverlay({ open, onClose }) {
  const { products, navigate, formatMoney } = useApp();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const panelRef = useRef(null);
  useDialogBehavior(open, onClose, panelRef);
  // Kept mounted for the exit animation's duration after `open` goes
  // false — without this, `if (!open) return null` unmounts instantly and
  // there's no DOM left for a closing transition to play against.
  const { rendered, closing } = useExitAnimation(open, 320);

  useEffect(() => {
    if (open) {
      setQuery('');
      // useDialogBehavior already focuses the first focusable element, but
      // that's the close button here (comes before the input in DOM order)
      // — explicitly focus the input instead so typing works immediately.
      const id = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(id);
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter((p) => `${p.name} ${p.category} ${p.collection} ${p.subtitle}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, products]);

  const go = (page, data) => {
    navigate(page, data);
    onClose();
  };

  if (!rendered) return null;

  return createPortal(
    <div className={`search-overlay fixed inset-0 z-[400] bg-bg ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="Search">
      <div ref={panelRef} className="h-full flex flex-col">
        <div className="search-overlay__bar border-b border-border px-6 lg:px-12 py-5 flex items-center gap-4">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-muted shrink-0">
            <circle cx="11" cy="11" r="7.5" /><line x1="21" y1="21" x2="16.2" y2="16.2" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search products, categories, collections…"
            className="flex-1 bg-transparent text-xl lg:text-2xl font-body text-fg placeholder:text-muted/50 outline-none"
          />
          <button onClick={onClose} aria-label="Close search" className="shrink-0 w-9 h-9 flex items-center justify-center border border-border">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="search-overlay__body flex-1 overflow-y-auto px-6 lg:px-12 py-8">
          {!query.trim() ? (
            <div className="max-w-screen-md mx-auto">
              <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-4">Popular Searches</p>
              <div className="flex flex-wrap gap-2">
                {POPULAR_SEARCHES.map((term) => (
                  <button key={term} onClick={() => setQuery(term)} className="text-[11px] font-mono uppercase tracking-widest px-4 py-2 border border-border text-muted hover:text-fg hover:border-fg/40 transition-colors">
                    {term}
                  </button>
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted max-w-screen-md mx-auto">No results for "{query}".</p>
          ) : (
            <div className="max-w-screen-md mx-auto space-y-1">
              <p key={results.length} className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-4">{results.length} Result{results.length === 1 ? '' : 's'}</p>
              {results.map((product, i) => (
                <a
                  key={product.id}
                  href={pageToPath('product', product)}
                  onClick={(e) => { e.preventDefault(); go('product', product); }}
                  className="search-result-row flex items-center gap-4 py-3 border-b border-border hover:bg-[var(--hover-overlay)] transition-colors"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="w-14 h-[72px] bg-card shrink-0 overflow-hidden">
                    <img src={product.images[0]} onError={handleImgError} alt="" className="w-full h-full up-photo object-cover" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-0.5">{product.subtitle}</p>
                    <p className="text-sm font-body text-fg truncate">{product.name}</p>
                  </div>
                  <span className="text-sm font-mono text-fg shrink-0">{formatMoney(product.price)}</span>
                </a>
              ))}
              <button onClick={() => go('shop')} className="w-full mt-4 py-3 text-[11px] font-mono uppercase tracking-widest border border-border text-fg hover:bg-[var(--hover-overlay)] transition-colors">
                View All Products
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
