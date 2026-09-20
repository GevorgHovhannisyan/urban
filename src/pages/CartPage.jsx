import { useState } from 'react';
import { useApp } from '../context/AppContext';
import ScrollReveal from '../components/ScrollReveal';
import { handleImgError } from '../utils/imageFallback';
import { useMagnetic } from '../hooks/useMagnetic';
import { FREE_US_SHIPPING_THRESHOLD, qualifiesForFreeUsShipping, ARMENIA_MAX_DELIVERY_DAYS, US_MAX_DELIVERY_DAYS } from '../data/shippingRules';
export default function CartPage() {
    const { cart, formatMoney, removeFromCart, updateQuantity, cartTotal, navigate, promo, discountAmount, applyPromoCode, removePromoCode, visitorCountry, isUnitedStates } = useApp();
    const checkoutBtnRef = useMagnetic(4);
    const [promoInput, setPromoInput] = useState('');
    const [promoError, setPromoError] = useState('');
    const [promoChecking, setPromoChecking] = useState(false);
    const shipping = 0; // Delivery cost is chosen and computed server-side at checkout (server/delivery.mjs).
    const total = Math.max(0, cartTotal - discountAmount) + shipping;
    // Detected region only — a pre-checkout UX hint, never a promise. The
    // real shipping cost AND delivery estimate are always calculated at
    // checkout from the address the customer actually enters there
    // (server/delivery.mjs), which can differ from this guess (see
    // order-api.mjs's validateOrderDraft — the delivery address always
    // wins). Urban Phoenix currently ships only to Armenia and the United
    // States (SUPPORTED_SHIPPING_COUNTRIES, src/data/countries.js) — a
    // visitor detected as neither gets a neutral, honest message naming
    // those two, never a "worldwide"/generic "international shipping"
    // claim implying broader coverage. The cart doesn't yet know a city, so
    // Armenia shows the honest ceiling (up to 7 days) rather than ever
    // claiming Yerevan-speed delivery before a real address is entered —
    // the actual city-aware estimate only ever appears at Checkout/on the
    // order once the real destination is known.
    const shippingMessage = visitorCountry === 'AM'
      ? `Armenia — free shipping, up to ${ARMENIA_MAX_DELIVERY_DAYS} business days.`
      : isUnitedStates
        ? (qualifiesForFreeUsShipping(cartTotal)
          ? `You've unlocked free U.S. shipping — up to ${US_MAX_DELIVERY_DAYS} business days.`
          : `${formatMoney(Math.max(0, FREE_US_SHIPPING_THRESHOLD - cartTotal), { regional: false })} away from free U.S. shipping.`)
        : 'We currently ship to Armenia and the United States. Shipping calculated at checkout.';

    const applyPromo = async () => {
        if (!promoInput.trim() || promoChecking) return;
        setPromoChecking(true);
        setPromoError('');
        const result = await applyPromoCode(promoInput);
        if (!result.ok) setPromoError(result.error);
        setPromoChecking(false);
    };
    const removePromo = () => {
        removePromoCode();
        setPromoInput('');
        setPromoError('');
    };

    return (<main className="bg-bg min-h-screen pt-[var(--site-header-h,68px)]">
      <div className="max-w-screen-2xl mx-auto px-6 lg:px-12 py-12">
        {/* Header */}
        <ScrollReveal>
          <div className="flex items-end justify-between mb-10">
            <div>
              <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-2">
                {cart.length} Item{cart.length !== 1 ? 's' : ''}
              </p>
              <h1 className="font-display font-black uppercase text-fg leading-none" style={{ fontSize: 'clamp(3rem, 6vw, 6rem)', letterSpacing: '-0.02em' }}>
                Your Bag
              </h1>
            </div>
            <button onClick={() => navigate('shop')} className="hidden lg:block text-[11px] font-mono text-muted hover:text-fg transition-colors tracking-[0.2em] uppercase border-b border-muted/30 pb-0.5">
              ← Continue Shopping
            </button>
          </div>
        </ScrollReveal>

        {cart.length === 0 ? (<div className="flex flex-col items-center justify-center py-32 gap-6 text-center">
            <div className="text-muted mb-2">
              <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
            </div>
            <h2 className="font-display font-black uppercase text-fg leading-none" style={{ fontSize: 'clamp(2rem, 4vw, 4rem)', letterSpacing: '-0.015em' }}>
              Your Bag Is Empty
            </h2>
            <p className="text-sm font-body font-light text-muted max-w-xs leading-relaxed">
              Discover Collection 001 — Freedom To Become.
            </p>
            <button onClick={() => navigate('shop')} className="bg-accent text-white px-10 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light transition-colors">
              Shop The Collection
            </button>
          </div>) : (<div className="grid lg:grid-cols-12 gap-8 lg:gap-14">
            {/* Cart items */}
            <div className="lg:col-span-7">
              <div className="divide-y divide-border">
                {cart.map(item => (<div key={`${item.product.id}-${item.size}-${item.color}-${(item.editionNumbers || []).join(',')}`} className="flex gap-5 py-6 first:pt-0">
                    <div className="bg-card overflow-hidden shrink-0 cursor-pointer" style={{ width: '100px', aspectRatio: '3/4' }} onClick={() => navigate('product', item.product)}>
                      <img src={item.product.images[0]} onError={handleImgError} alt={item.product.name} className="w-full h-full up-photo object-cover hover:scale-105 transition-transform duration-500"/>
                    </div>
                    <div className="flex-1 min-w-0 flex flex-col">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div>
                          <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-1">{item.product.collection}</p>
                          <button onClick={() => navigate('product', item.product)} className="text-sm font-body font-medium text-fg leading-snug hover:text-muted transition-colors text-left">
                            {item.product.name}
                          </button>
                        </div>
                        <p className="text-sm font-mono text-fg shrink-0">{formatMoney(item.product.price * item.quantity)}</p>
                      </div>
                      <p className="text-[11px] font-mono text-muted mb-4">
                        {item.color} · Size {item.size} · {formatMoney(item.product.price)} each
                      </p>
                      {item.editionNumbers?.length > 0 && (
                        <p className="cart-editions">Piece {item.editionNumbers.map((number) => String(number).padStart(3, '0')).join(', ')} / {String(item.product.limitedEditionTotal || 100).padStart(3, '0')}</p>
                      )}
                      <div className="flex items-center justify-between mt-auto">
                        {item.editionNumbers?.length > 0 ? (
                          <p className="text-[10px] font-mono text-muted tracking-wide max-w-[180px]">
                            Quantity fixed for limited editions — remove and re-add from the product page to change it.
                          </p>
                        ) : (
                          <div className="flex items-center border border-border">
                            <button onClick={() => updateQuantity(item.product.id, item.size, item.color, item.quantity - 1, item.editionNumbers)} className="w-9 h-9 flex items-center justify-center text-muted hover:text-fg transition-colors">
                              −
                            </button>
                            <span className="w-10 text-center text-xs font-mono text-fg">{item.quantity}</span>
                            <button disabled={item.quantity >= 100} onClick={() => updateQuantity(item.product.id, item.size, item.color, Math.min(100, item.quantity + 1), item.editionNumbers)} className="w-9 h-9 flex items-center justify-center text-muted hover:text-fg transition-colors">
                              +
                            </button>
                          </div>
                        )}
                        <button onClick={() => removeFromCart(item.product.id, item.size, item.color, item.editionNumbers)} className="text-[10px] font-mono text-muted hover:text-fg transition-colors tracking-widest uppercase flex items-center gap-1.5">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>))}
              </div>

              {/* Promo code */}
              <div className="mt-6 pt-6 border-t border-border">
                <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-3">Promo Code</p>
                {promo ? (<div className="flex items-center gap-3 border border-accent px-4 py-3 w-fit">
                    <span className="text-[11px] font-mono text-accent tracking-widest uppercase">{promo.code} applied</span>
                    <button onClick={removePromo} className="text-[10px] font-mono text-muted hover:text-fg underline tracking-widest uppercase">Remove</button>
                  </div>) : (<div className="flex gap-0">
                    <input type="text" value={promoInput} onChange={e => { setPromoInput(e.target.value); setPromoError(''); }} placeholder="Enter code" className="flex-1 max-w-[220px] bg-transparent border border-border px-4 py-3 text-sm font-mono text-fg placeholder:text-muted/40 focus:outline-none focus:border-accent transition-colors uppercase tracking-widest"/>
                    <button onClick={applyPromo} disabled={promoChecking || !promoInput.trim()} className="border border-border border-l-0 px-5 py-3 text-[10px] font-mono text-muted hover:text-fg hover:border-fg/30 transition-colors tracking-widest uppercase disabled:opacity-50">
                      {promoChecking ? '…' : 'Apply'}
                    </button>
                  </div>)}
                {promoError && <p className="text-[10px] font-mono status-error mt-2 tracking-wide">{promoError}</p>}
              </div>
            </div>

            {/* Order summary */}
            <div className="lg:col-span-5">
              <div className="bg-card border border-border p-6 lg:p-8 sticky top-24">
                <h2 className="font-display font-black uppercase text-fg text-2xl tracking-wider mb-6">Order Summary</h2>

                <div className="space-y-3 mb-6">
                  <div className="flex justify-between">
                    <span className="text-sm font-mono text-muted">Subtotal</span>
                    <span className="text-sm font-mono text-fg">{formatMoney(cartTotal, { regional: false })}</span>
                  </div>
                  {discountAmount > 0 && (<div className="flex justify-between">
                      <span className="text-sm font-mono text-accent">Discount</span>
                      <span className="text-sm font-mono text-accent">−{formatMoney(discountAmount, { regional: false })}</span>
                    </div>)}
                  <div className="flex justify-between">
                    <span className="text-sm font-mono text-muted">Shipping</span>
                    <span className="text-sm font-mono text-fg">
                      {shipping === 0 ? 'Calculated at checkout' : formatMoney(shipping, { regional: false })}
                    </span>
                  </div>
                  <p className="text-[10px] font-mono text-muted tracking-wide">{shippingMessage}</p>
                </div>

                <div className="border-t border-border pt-4 mb-6">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase">Total</span>
                    <span className="text-xl font-mono text-fg">{formatMoney(total, { regional: false })}</span>
                  </div>
                </div>

                <button ref={checkoutBtnRef} onClick={() => navigate('checkout')} className="magnetic-btn w-full bg-accent text-white py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light mb-3">
                  Proceed to Checkout
                </button>

                {/* Payment methods */}
                <div className="flex gap-2 mt-4 pt-4 border-t border-border">
                  {['Visa', 'MC', 'Amex', 'PayPal', 'Apple Pay'].map(m => (<span key={m} className="text-[9px] font-mono text-muted border border-border px-1.5 py-0.5">{m}</span>))}
                </div>
              </div>
            </div>
          </div>)}
      </div>
    </main>);
}
