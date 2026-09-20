import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Block } from '../Skeleton';

const STATUS_LABELS = {
  payment_pending: 'Payment pending',
  confirmed: 'Confirmed',
  processing: 'Processing',
  shipped: 'Shipped',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const CARD_ICONS = {
  orders: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  ),
  wishlist: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  ),
  rewards: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" />
    </svg>
  ),
};

export default function AccountOverview({ onNavigate }) {
  const { user, accountFetch, navigate, formatMoney } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [recentOrders, setRecentOrders] = useState([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    accountFetch('/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Reuses the same token-secured order-history endpoint AccountOrders.jsx
    // already calls — /overview only carries a single latestOrder summary
    // (no line items/images), and a real thumbnail-bearing "recent orders"
    // strip needs the full order objects this endpoint already returns.
    fetch('/api/orders/mine', { headers: { Authorization: `Bearer ${user?.sessionToken}` } })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setRecentOrders(Array.isArray(d.orders) ? d.orders.slice(0, 3) : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setOrdersLoading(false); });
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="space-y-8">
        <Block className="h-9 w-56" />
        <Block className="h-28" />
        <div className="grid sm:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Block key={i} className="h-32" />)}
        </div>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-fg/70">Could not load your overview right now.</p>;

  const displayName = (user?.firstName || data.firstName || 'Member').toString();
  const points = data.loyaltyPoints || 0;

  return (
    <div className="space-y-10">
      {/* Header — compact: small label, large name, one line of secondary
          metadata. Member Since moved here (out of the profile card below)
          so it isn't stated twice on the same page. */}
      <div>
        <p className="text-[10px] font-mono text-accent tracking-[.25em] uppercase mb-1.5">Welcome back</p>
        <h1 className="text-4xl lg:text-5xl font-display font-black uppercase leading-none mb-2">
          {displayName}
        </h1>
        <p className="text-xs font-mono text-fg/60 tracking-widest uppercase">Member since {data.memberSince}</p>
      </div>

      {/* Member profile card — identity + membership facts only; no
          restated "member since" now that the header carries it. */}
      <div className="relative overflow-hidden border border-border bg-gradient-to-br from-fg/[0.04] via-transparent to-accent/[0.06]">
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-accent via-accent-light to-accent" aria-hidden="true" />
        <p
          aria-hidden="true"
          className="absolute -right-4 -bottom-8 font-display font-black uppercase leading-[0.8] select-none pointer-events-none text-fg"
          style={{ fontSize: '110px', letterSpacing: '-0.02em', opacity: 0.04 }}
        >
          UP
        </p>
        <div className="relative p-6 lg:p-8 flex flex-wrap items-center gap-x-14 gap-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 border border-accent/50 flex items-center justify-center shrink-0" aria-hidden="true">
              <span className="font-display font-black text-lg text-accent">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <p className="text-[10px] font-mono text-fg/60 tracking-[.2em] uppercase mb-1">Urban Phoenix</p>
              <p className="text-sm font-display font-black uppercase tracking-wide">Member Profile</p>
            </div>
          </div>
          <div>
            <p className="text-[10px] font-mono text-fg/60 tracking-[.2em] uppercase mb-1">Member ID</p>
            <p className="text-lg font-mono tracking-[0.15em]">{data.memberId}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono text-fg/60 tracking-[.2em] uppercase mb-1">Status</p>
            <p className="text-lg font-mono tracking-[0.1em] text-accent-light">Active</p>
          </div>
          <div>
            <p className="text-[10px] font-mono text-fg/60 tracking-[.2em] uppercase mb-1">UP Points</p>
            <p className="text-lg font-mono tracking-[0.1em]">{points.toLocaleString()}</p>
          </div>
          <button
            onClick={() => onNavigate('rewards')}
            className="ml-auto text-[11px] font-mono tracking-[0.15em] uppercase text-muted hover:text-accent-light transition-colors border-b border-muted/40 hover:border-accent-light/60 pb-0.5"
          >
            View rewards →
          </button>
        </div>
      </div>

      {/* Overview cards — each one is a real destination, not just a number. */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <OverviewCard
          icon={CARD_ICONS.orders}
          label="Orders"
          value={data.totalOrders || 0}
          onClick={() => onNavigate('orders')}
          cta="View orders →"
          empty={!data.totalOrders}
          emptyTitle="No orders yet."
          emptyBody="Explore latest drops →"
          onEmptyClick={() => navigate('drop')}
        />
        <OverviewCard
          icon={CARD_ICONS.wishlist}
          label="Wishlist"
          value={data.wishlistCount || 0}
          sub={data.wishlistCount ? 'Saved items' : undefined}
          onClick={() => onNavigate('wishlist')}
          cta="View wishlist →"
          empty={!data.wishlistCount}
          emptyTitle="Your wishlist is empty."
          emptyBody="Discover pieces →"
          onEmptyClick={() => navigate('shop')}
        />
        <OverviewCard
          icon={CARD_ICONS.rewards}
          label="Rewards"
          value={points.toLocaleString()}
          sub={points ? (data.loyaltyPointsValue ? `$${data.loyaltyPointsValue} available` : 'UP Points') : undefined}
          onClick={() => onNavigate('rewards')}
          cta="Explore rewards →"
          empty={!points}
          emptyTitle="Start earning rewards with your purchases."
          emptyBody="Learn about rewards →"
          onEmptyClick={() => onNavigate('rewards')}
        />
      </div>

      {/* Recent orders — wider strip beneath the cards; replaces the old
          single "Latest Order" stat tile with real, browsable rows. */}
      <div>
        <div className="flex items-end justify-between gap-4 mb-4">
          <h2 className="text-[11px] font-mono text-fg/70 tracking-[.22em] uppercase">Recent Orders</h2>
          {recentOrders.length > 0 && (
            <button
              onClick={() => onNavigate('orders')}
              className="text-[11px] font-mono tracking-[0.15em] uppercase text-muted hover:text-fg transition-colors border-b border-muted/40 hover:border-fg/50 pb-0.5"
            >
              View all →
            </button>
          )}
        </div>

        {ordersLoading ? (
          <div className="border border-border p-5 space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex gap-4 items-center">
                <Block className="w-14 h-[72px] shrink-0" />
                <div className="flex-1 space-y-2">
                  <Block className="h-3 w-1/3" />
                  <Block className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : recentOrders.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-3 py-16 px-6 border border-border">
            <p className="font-display font-black uppercase text-xl">No orders yet</p>
            <p className="text-sm text-fg/60 max-w-xs">Your first piece is waiting.</p>
            <button
              onClick={() => navigate('collection')}
              className="mt-1 btn-primary px-7 py-3 text-[11px] font-mono uppercase tracking-widest"
            >
              Explore Collection
            </button>
          </div>
        ) : (
          <ul className="border border-border divide-y divide-border">
            {recentOrders.map((order) => {
              const thumb = order.items?.[0]?.image;
              const itemCount = order.items?.reduce((sum, item) => sum + (item.quantity || 1), 0) || order.items?.length || 0;
              return (
                // Two explicit rows (thumbnail+identity, then status/price/
                // action) rather than one `flex-wrap` row — with a single
                // flex-wrap row, the min-w-0 order-number block was willing
                // to shrink to near-nothing to keep the shrink-0 status/
                // price/button on the same line instead of actually
                // wrapping, crushing the order number unreadable on narrow
                // screens instead of moving those to their own line.
                <li key={order.id} className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 p-4 lg:p-5">
                  <div className="flex items-center gap-4 min-w-0 flex-1">
                    {thumb ? (
                      <img src={thumb} alt="" className="w-12 h-16 up-photo object-cover bg-card shrink-0" />
                    ) : (
                      <div className="w-12 h-16 bg-card shrink-0" aria-hidden="true" />
                    )}
                    <div className="min-w-0">
                      <p className="font-mono text-sm mb-0.5 truncate">
                        Order #{order.orderNumber}
                        {itemCount > 0 && <span className="text-fg/50"> · {itemCount} item{itemCount === 1 ? '' : 's'}</span>}
                      </p>
                      <p className="text-[11px] font-mono text-fg/60 uppercase tracking-widest">
                        {new Date(order.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:gap-4 pl-16 sm:pl-0">
                    <span className="text-[11px] uppercase tracking-widest border border-border px-3 py-1.5 shrink-0">
                      {STATUS_LABELS[order.status] || order.status}
                    </span>
                    <span className="font-mono text-sm shrink-0">{formatMoney(order.total, { regional: false })}</span>
                    <button
                      onClick={() => onNavigate('orders')}
                      aria-label={`View order ${order.orderNumber}`}
                      className="text-[11px] font-mono tracking-[0.15em] uppercase text-muted hover:text-fg transition-colors border-b border-muted/40 hover:border-fg/50 pb-0.5 shrink-0"
                    >
                      View order →
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {data.defaultAddress && (
        <div className="border-t border-border pt-8">
          <p className="text-[10px] font-mono text-fg/60 tracking-[.2em] uppercase mb-3">Default Shipping Address</p>
          <p className="text-sm leading-relaxed">
            {data.defaultAddress.firstName} {data.defaultAddress.lastName}<br />
            {data.defaultAddress.address}{data.defaultAddress.apartment ? `, ${data.defaultAddress.apartment}` : ''}<br />
            {data.defaultAddress.city}, {data.defaultAddress.postalCode}<br />
            {data.defaultAddress.country}
          </p>
        </div>
      )}
    </div>
  );
}

// A single overview card, aware of its own empty state — when there's
// nothing to show yet, it swaps its stat for a short contextual nudge
// instead of just presenting another 0, and its click target follows that
// nudge's own destination rather than the section it would otherwise open.
function OverviewCard({ icon, label, value, sub, cta, onClick, empty, emptyTitle, emptyBody, onEmptyClick }) {
  const action = empty ? onEmptyClick : onClick;
  const actionLabel = empty ? emptyBody : cta;
  return (
    <button
      onClick={action}
      className="group relative border border-border p-5 text-left overflow-hidden transition-colors duration-300 hover:border-accent/40 focus-visible:border-accent/40"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-accent/0 to-accent/0 group-hover:from-accent/[0.06] group-hover:to-transparent transition-colors duration-300" aria-hidden="true" />
      <div className="relative">
        <div className="text-fg/60 group-hover:text-accent transition-colors duration-300 mb-4">{icon}</div>
        <p className="text-[10px] font-mono text-fg/60 tracking-[.2em] uppercase mb-2">{label}</p>
        {empty ? (
          <p className="text-sm text-fg/80 leading-snug max-w-[22ch]">{emptyTitle}</p>
        ) : (
          <>
            <p className="text-2xl font-display font-black uppercase leading-none">{value}</p>
            {sub && <p className="text-xs text-fg/60 font-mono mt-1.5">{sub}</p>}
          </>
        )}
        <p className="text-[11px] font-mono tracking-[0.1em] uppercase text-muted group-hover:text-accent-light transition-colors mt-4">
          {actionLabel}
        </p>
      </div>
    </button>
  );
}
