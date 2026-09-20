import { useApp } from '../../context/AppContext';
import { EmptyState } from './AccountOrders';

export default function AccountWishlist() {
  const { wishlist, products, toggleWishlist, navigate, formatMoney } = useApp();
  const items = products.filter((p) => wishlist.includes(p.id));

  if (items.length === 0) {
    return (
      <EmptyState
        title="Your wishlist is empty."
        body="Items you save will appear here."
        cta="Shop Collection"
        onCta={() => navigate('shop')}
      />
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-display font-black uppercase mb-8">Wishlist</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {items.map((product) => (
          <div key={product.id} className="border border-border">
            <button onClick={() => navigate('product', product)} className="block w-full aspect-[3/4] bg-card overflow-hidden">
              {product.images?.[0] && <img src={product.images[0]} alt={product.name} className="w-full h-full up-photo object-cover" />}
            </button>
            <div className="p-4">
              {product.collection && <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-1">{product.collection}</p>}
              <button onClick={() => navigate('product', product)} className="text-sm font-medium text-left block mb-1 hover:text-muted">
                {product.name}
              </button>
              <p className="text-sm font-mono mb-4">{formatMoney(product.price)}</p>
              <div className="flex gap-3">
                <button onClick={() => navigate('product', product)} className="flex-1 border border-border py-2.5 text-[10px] font-mono uppercase tracking-widest hover:bg-fg/5">
                  View Product
                </button>
                <button onClick={() => toggleWishlist(product.id)} className="text-[10px] font-mono uppercase tracking-widest text-muted hover:text-fg underline">
                  Remove
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
