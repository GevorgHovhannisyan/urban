import { useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { handleImgError } from '../utils/imageFallback';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { useExitAnimation } from '../hooks/useExitAnimation';
import { FREE_US_SHIPPING_THRESHOLD, qualifiesForFreeUsShipping } from '../data/shippingRules';

export default function CartDrawer() {
    const { cart, formatMoney, cartOpen, setCartOpen, removeFromCart, updateQuantity, cartTotal, navigate, isUnitedStates } = useApp();
    const panelRef = useRef(null);
    useDialogBehavior(cartOpen, () => setCartOpen(false), panelRef);
    // Kept mounted through its own exit animation instead of unmounting the
    // instant cartOpen goes false, mirroring SearchOverlay.
    const { rendered, closing } = useExitAnimation(cartOpen, 320);
    // Removing a line item plays a brief collapse/fade on that row *before*
    // the real removeFromCart() call actually drops it from cart state —
    // cart data/business logic is untouched, this only delays when the
    // already-decided removal is applied.
    const [removingKey, setRemovingKey] = useState(null);
    // Identity must match the same product+size+color+serials key used
    // everywhere else a cart line is addressed (see AppContext's
    // sameCartLine) — otherwise two Limited Edition lines of the same
    // product/size/color (different serials) would collide here too.
    const cartItemKey = (item) => `${item.product.id}-${item.size}-${item.color}-${(item.editionNumbers || []).join(',')}`;
    const handleRemove = (item) => {
        const key = cartItemKey(item);
        setRemovingKey(key);
        setTimeout(() => {
            removeFromCart(item.product.id, item.size, item.color, item.editionNumbers);
            setRemovingKey(null);
        }, 260);
    };
    if (!rendered)
        return null;
    // Inclusive — a cart sitting at exactly $150.00 already qualifies (see
    // server/delivery.mjs, the actual authority on the real charge).
    const qualifiesForFreeShipping = qualifiesForFreeUsShipping(cartTotal);
    const remainingForFreeShipping = qualifiesForFreeShipping ? 0 : Math.max(0.01, Number((FREE_US_SHIPPING_THRESHOLD - cartTotal).toFixed(2)));
    const freeShippingProgress = qualifiesForFreeShipping ? 100 : Math.min(99, (cartTotal / FREE_US_SHIPPING_THRESHOLD) * 100);
    return (<>
      {/* Backdrop */}
      <div className={`fixed inset-0 z-[70] bg-[var(--overlay-scrim)] backdrop-blur-sm ${closing ? 'cart-backdrop-out' : 'cart-backdrop-in'}`} onClick={() => setCartOpen(false)}/>

      {/* Drawer */}
      <div ref={panelRef} className={`cart-drawer fixed top-0 right-0 bottom-0 z-[70] w-full max-w-[420px] bg-bg border-l border-border flex flex-col ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-label="Your Bag">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-border">
          <div>
            <h2 className="font-display font-black text-xl uppercase tracking-wider text-fg">Your Bag</h2>
            {cart.length > 0 && (<p className="text-[11px] font-mono text-muted mt-0.5 tracking-widest uppercase">
                {cart.reduce((s, i) => s + i.quantity, 0)} Item{cart.reduce((s, i) => s + i.quantity, 0) !== 1 ? 's' : ''}
              </p>)}
          </div>
          <button onClick={() => setCartOpen(false)} aria-label="Close bag" className="text-muted hover:text-fg transition-colors p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Free shipping progress */}
        {cart.length > 0 && isUnitedStates && (
          <div className="px-6 py-4 border-b border-border">
            {remainingForFreeShipping > 0 ? (
              <p key={remainingForFreeShipping} className="text-[11px] font-mono text-muted tracking-wide mb-2">
                <span className="text-fg">{formatMoney(remainingForFreeShipping, { regional: false })}</span> away from free U.S. shipping
              </p>
            ) : (
              <p className="text-[11px] font-mono text-accent-light tracking-wide mb-2 uppercase">✓ You've unlocked free U.S. shipping</p>
            )}
            <div className="h-1 bg-border overflow-hidden">
              <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${freeShippingProgress}%` }} />
            </div>
          </div>
        )}

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {cart.length === 0 ? (<div className="flex flex-col items-center justify-center h-full gap-4 px-6">
              <div className="text-muted">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <path d="M16 10a4 4 0 0 1-8 0"/>
                </svg>
              </div>
              <p className="text-sm font-body text-muted text-center">Your bag is empty.</p>
              <button onClick={() => { navigate('shop'); setCartOpen(false); }} className="text-[11px] font-mono tracking-[0.2em] uppercase text-fg border border-border px-6 py-2.5 hover:bg-[var(--hover-overlay)] transition-colors">
                Shop Collection
              </button>
            </div>) : (<ul className="divide-y divide-border">
              {cart.map(item => {
                const itemKey = cartItemKey(item);
                return (<li key={itemKey} className={`cart-item-row flex gap-4 px-6 py-5 ${removingKey === itemKey ? 'is-removing' : ''}`}>
                  <div className="w-24 h-32 bg-card shrink-0 overflow-hidden">
                    <img src={item.product.images[0]} onError={handleImgError} alt={item.product.name} className="w-full h-full up-photo object-cover"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between gap-2 mb-1">
                      <p className="text-sm font-body font-medium text-fg leading-tight truncate">{item.product.name}</p>
                      <p key={item.quantity} className="text-sm font-mono text-fg shrink-0 cart-value-pop">{formatMoney(item.product.price * item.quantity)}</p>
                    </div>
                    <p className="text-[11px] font-mono text-muted tracking-wide mb-3">
                      {item.color} · Size {item.size}
                    </p>
                    {item.editionNumbers?.length > 0 && (
                      <p className="cart-editions">Edition {item.editionNumbers.map((number) => String(number).padStart(3, '0')).join(', ')} / {String(item.product.limitedEditionTotal || 100).padStart(3, '0')}</p>
                    )}
                    <div className="flex items-center justify-between">
                      {item.editionNumbers?.length > 0 ? (
                        <span className="text-[10px] font-mono text-muted">Qty {item.quantity} · fixed</span>
                      ) : (
                        <div className="flex items-center border border-border">
                          <button onClick={() => updateQuantity(item.product.id, item.size, item.color, item.quantity - 1, item.editionNumbers)} className="w-7 h-7 flex items-center justify-center text-muted hover:text-fg transition-colors text-sm">
                            −
                          </button>
                          <span key={item.quantity} className="w-6 text-center text-xs font-mono text-fg cart-value-pop">{item.quantity}</span>
                          <button disabled={item.quantity >= 100} onClick={() => updateQuantity(item.product.id, item.size, item.color, Math.min(100, item.quantity + 1), item.editionNumbers)} className="w-7 h-7 flex items-center justify-center text-muted hover:text-fg transition-colors text-sm">
                            +
                          </button>
                        </div>
                      )}
                      <button onClick={() => handleRemove(item)} className="text-[10px] font-mono text-muted hover:text-fg transition-colors tracking-widest uppercase underline underline-offset-2">
                        Remove
                      </button>
                    </div>
                  </div>
                </li>);
              })}
            </ul>)}
        </div>

        {/* Footer */}
        {cart.length > 0 && (<div className="px-6 py-6 border-t border-border space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-xs font-mono text-muted tracking-widest uppercase">Subtotal</span>
              <span key={cartTotal} className="text-base font-mono text-fg cart-value-pop">{formatMoney(cartTotal, { regional: false })}</span>
            </div>
            <p className="text-[11px] font-mono text-muted tracking-wide">Shipping and taxes calculated at checkout</p>
            <button onClick={() => { navigate('cart'); setCartOpen(false); }} className="btn-motion w-full bg-accent text-white py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light">
              View Bag & Checkout
            </button>
            <button onClick={() => setCartOpen(false)} className="w-full border border-border text-fg py-3.5 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-[var(--hover-overlay)] transition-colors">
              Continue Shopping
            </button>
          </div>)}
      </div>
    </>);
}
