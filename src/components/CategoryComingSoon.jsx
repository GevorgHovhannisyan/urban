import { useState } from 'react';

// Shown on the Shop page when a category has no live products yet (e.g.
// T-Shirts, Pants, Outerwear, Accessories while only Hoodies has real stock).
// Deliberately styled as a real page moment — not a generic "no results" —
// so an intentionally-empty category still reads as part of the brand
// instead of a dead end.
export default function CategoryComingSoon({ categoryLabel, onShopHoodies }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle');

  const submit = async (e) => {
    e.preventDefault();
    if (!email || status === 'submitting') return;
    setStatus('submitting');
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) throw new Error();
      setStatus('done');
    } catch {
      setStatus('error');
    }
  };

  return (
    <div className="py-20 lg:py-28 flex flex-col items-center text-center px-6">
      <p className="text-[10px] font-mono text-accent tracking-[0.3em] uppercase mb-5">
        {categoryLabel} — Coming Soon
      </p>
      <h2 className="font-display font-black uppercase text-fg leading-[0.9] mb-6" style={{ fontSize: 'clamp(2.25rem, 6vw, 4.5rem)', letterSpacing: '-0.02em' }}>
        Not Released<br />Yet.
      </h2>
      <p className="text-sm font-body text-muted max-w-md mb-10 leading-relaxed">
        This category is part of a future drop. {categoryLabel} hasn't landed yet — Collection 001 is still becoming what it will be.
      </p>

      <div className="flex flex-col sm:flex-row items-center gap-4 mb-10">
        <button onClick={onShopHoodies} className="bg-accent text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light transition-colors">
          Shop Hoodies →
        </button>
      </div>

      <div className="w-full max-w-sm border-t border-border pt-8">
        <p className="text-[10px] font-mono text-muted tracking-[0.2em] uppercase mb-4">Be first when it drops</p>
        {status === 'done' ? (
          <p className="text-sm font-mono text-accent-light uppercase tracking-widest">✓ You're on the list.</p>
        ) : (
          <form onSubmit={submit} className="flex gap-0">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Your email address"
              required
              className="flex-1 min-w-0 bg-transparent border border-border px-4 py-3 text-sm text-fg placeholder:text-muted/50 focus:outline-none focus:border-accent transition-colors"
            />
            <button type="submit" disabled={status === 'submitting'} className="bg-accent text-white px-5 py-3 text-[11px] font-mono tracking-[0.15em] uppercase hover:bg-accent-light transition-colors shrink-0 disabled:opacity-50">
              {status === 'submitting' ? '…' : 'Notify Me'}
            </button>
          </form>
        )}
        {status === 'error' && <p className="text-[11px] font-mono status-error mt-3">Could not subscribe right now.</p>}
      </div>
    </div>
  );
}
