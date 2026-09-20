import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { EmptyState } from './AccountOrders';
import { ProductGridSkeleton } from '../Skeleton';

// Real, existing collection taglines (already used verbatim elsewhere across
// the site — e.g. CollectionPage.jsx, HomePage.jsx) — not invented copy.
// Falls back to just the collection name for a future collection this map
// hasn't been updated for yet, rather than showing nothing.
const COLLECTION_TAGLINES = {
  'Collection 001': 'Freedom To Become',
};

export default function LimitedPiecesArchive() {
  const { accountFetch, navigate } = useApp();
  const [pieces, setPieces] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    accountFetch('/limited-pieces')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setPieces(Array.isArray(d.pieces) ? d.pieces : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <ProductGridSkeleton count={4} cols={4} />;

  if (pieces.length === 0) {
    return (
      <EmptyState
        title="Your archive is empty."
        body="Urban Phoenix pieces you acquire will appear here."
        cta="Explore Collection"
        onCta={() => navigate('collection')}
      />
    );
  }

  return (
    <div>
      <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-1">Urban Phoenix</p>
      <h2 className="text-3xl font-display font-black uppercase mb-8">Archive</h2>

      <div className="grid sm:grid-cols-2 gap-6">
        {pieces.map((piece, i) => (
          <div key={i} className="border border-border group">
            <div className="aspect-[3/4] bg-card overflow-hidden">
              {piece.image ? (
                <img src={piece.image} alt={piece.name} className="w-full h-full up-photo object-cover group-hover:scale-105 transition-transform duration-500" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted text-xs font-mono uppercase">No image</div>
              )}
            </div>
            <div className="p-5">
              {piece.collection && (
                <>
                  <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-0.5">{piece.collection}</p>
                  {COLLECTION_TAGLINES[piece.collection] && (
                    <p className="text-[10px] font-mono text-accent tracking-[.2em] uppercase mb-1">{COLLECTION_TAGLINES[piece.collection]}</p>
                  )}
                </>
              )}
              <p className="font-display font-black uppercase text-lg leading-tight mb-1">{piece.name}</p>
              <p className="text-xs text-muted font-mono uppercase mb-4">
                {piece.color} / Size {piece.size}
                {piece.number === null && piece.quantity > 1 ? ` · Qty ${piece.quantity}` : ''}
              </p>

              {/* Serial/piece numbering only ever renders when this exact
                  item was genuinely claimed as a numbered edition at
                  checkout (server/edition-api.mjs's edition_sales table) —
                  never shown, and never fabricated, for a standard-release
                  purchase. */}
              {piece.number !== null && (
                <p className="text-3xl font-mono tracking-widest text-accent mb-4">
                  Piece {String(piece.number).padStart(3, '0')}<span className="text-muted text-lg"> / {String(piece.editionTotal || 100).padStart(3, '0')}</span>
                </p>
              )}

              <div className="flex justify-between text-[10px] font-mono text-muted uppercase tracking-widest border-t border-border pt-3">
                <div>
                  <p className="mb-0.5">Acquired</p>
                  <p className="text-fg">{new Date(piece.acquiredAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</p>
                </div>
                <div className="text-right">
                  <p className="mb-0.5">Order</p>
                  <p className="text-fg">{piece.orderNumber}</p>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
