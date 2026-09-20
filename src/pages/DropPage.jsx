import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { handleImgError } from '../utils/imageFallback';
import ScrollReveal from '../components/ScrollReveal';
import { PageSkeleton } from '../components/Skeleton';

function useCountdown(target) {
  const [remaining, setRemaining] = useState(() => Math.max(0, new Date(target).getTime() - Date.now()));
  useEffect(() => {
    const id = setInterval(() => {
      setRemaining(Math.max(0, new Date(target).getTime() - Date.now()));
    }, 1000);
    return () => clearInterval(id);
  }, [target]);
  const totalSeconds = Math.floor(remaining / 1000);
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    done: remaining <= 0,
  };
}

// Only ever rendered inside DropPage's cinematic hero, on top of the photo
// scrim below — literal white, not theme-reactive text-fg/text-muted.
function CountdownUnit({ value, label }) {
  return (
    <div className="text-center">
      <p key={value} className="font-display font-black text-4xl lg:text-6xl tabular-nums text-white">{String(value).padStart(2, '0')}</p>
      <p className="text-[9px] font-mono text-white/70 tracking-[0.2em] uppercase mt-1">{label}</p>
    </div>
  );
}

function NotifyForm() {
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

  if (status === 'done') {
    return <p className="text-sm font-mono text-accent-light uppercase tracking-widest">✓ You're on the list.</p>;
  }

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row gap-0 max-w-md">
      <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Your email address" required className="flex-1 bg-transparent border border-border px-5 py-4 text-sm text-fg placeholder:text-muted/50 focus:outline-none focus:border-accent transition-colors" />
      <button type="submit" disabled={status === 'submitting'} className="bg-accent text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light transition-colors shrink-0 disabled:opacity-50">
        {status === 'submitting' ? 'Submitting…' : 'Notify Me'}
      </button>
    </form>
  );
}

export default function DropPage() {
  const { navigate, user } = useApp();
  const [drops, setDrops] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/drops')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setDrops(Array.isArray(d.drops) ? d.drops : []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const next = drops[0];
  // Called unconditionally (Rules of Hooks) — falls back to "now" when there's
  // no upcoming drop yet, which just counts down to zero and is never shown.
  const countdown = useCountdown(next?.releaseAt || Date.now());

  if (loading) return <PageSkeleton />;

  if (!next) {
    return (
      <main className="bg-bg min-h-screen pt-[var(--site-header-h,68px)] flex items-center justify-center px-6">
        <div className="text-center max-w-md">
          <p className="text-[10px] font-mono text-muted tracking-[0.3em] uppercase mb-6">New Drop</p>
          <h1 className="font-display font-black uppercase text-fg leading-[0.9] mb-6" style={{ fontSize: 'clamp(2.5rem, 6vw, 5rem)' }}>
            Nothing<br />Scheduled — Yet
          </h1>
          <p className="text-sm text-muted mb-10">The next drop hasn't been announced. Be the first to know when it lands.</p>
          <div className="flex justify-center"><NotifyForm /></div>
        </div>
      </main>
    );
  }

  const revealDate = new Date(next.releaseAt);

  return (
    <main className="bg-bg min-h-screen">
      {/* Cinematic hero */}
      <section className="relative h-screen min-h-[600px] flex items-end overflow-hidden">
        <img src={next.images?.[0]} onError={handleImgError} alt="" fetchPriority="high" className="up-photo absolute inset-0 w-full h-full object-cover scale-110" style={{ filter: 'brightness(0.55) blur(2px)' }} />
        {/* Literal black/white, not bg-bg/text-fg: this scrim and the
            content over it sit on top of photography, not page chrome, so
            they must not flip with the theme. */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/20" />

        <div className="relative z-10 w-full max-w-screen-2xl mx-auto px-6 lg:px-12 pb-16 lg:pb-24">
          <p className="text-[10px] font-mono text-accent tracking-[0.35em] uppercase mb-6">
            {next.dropStatus === 'early-access' ? 'Early Access Now Open' : 'Next Drop'}
          </p>
          <h1 className="font-display font-black uppercase text-white leading-[0.88] mb-10" style={{ fontSize: 'clamp(3rem, 9vw, 9rem)', letterSpacing: '-0.02em' }}>
            {next.name}
          </h1>

          <div className="flex gap-6 lg:gap-10 mb-10">
            <CountdownUnit value={countdown.days} label="Days" />
            <CountdownUnit value={countdown.hours} label="Hours" />
            <CountdownUnit value={countdown.minutes} label="Minutes" />
            <CountdownUnit value={countdown.seconds} label="Seconds" />
          </div>

          <p className="text-xs font-mono text-white/70 tracking-widest uppercase mb-8">
            Drops {revealDate.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>

          {next.dropStatus === 'early-access' && !user && (
            <div className="mb-6">
              <p className="text-sm text-white/70 mb-4 max-w-md">Early access is open to signed-in members. Sign in to shop before it goes public.</p>
              <button onClick={() => navigate('login')} className="bg-accent text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light transition-colors">
                Sign In For Early Access
              </button>
            </div>
          )}
          {next.dropStatus === 'early-access' && user && (
            <button onClick={() => navigate('product', { id: next.id })} className="bg-accent text-white px-8 py-4 text-[11px] font-mono tracking-[0.2em] uppercase hover:bg-accent-light transition-colors mb-6">
              Shop Early Access
            </button>
          )}
          {next.dropStatus === 'upcoming' && <NotifyForm />}
        </div>
      </section>

      {/* Reveal cards */}
      {drops.length > 0 && (
        <section className="py-24 max-w-screen-2xl mx-auto px-6 lg:px-12">
          <ScrollReveal>
            <p className="text-[10px] font-mono text-muted tracking-[0.25em] uppercase mb-2">Coming Up</p>
            <h2 className="font-display font-black uppercase text-fg leading-none mb-12" style={{ fontSize: 'clamp(2rem, 4vw, 3.5rem)', letterSpacing: '-0.015em' }}>
              {drops.length} Piece{drops.length === 1 ? '' : 's'} Revealed
            </h2>
          </ScrollReveal>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:gap-5">
            {drops.map((d, i) => (
              <ScrollReveal key={d.id} delay={i * 80}>
                <div className="relative overflow-hidden bg-card" style={{ aspectRatio: '3/4' }}>
                  <img src={d.images?.[0]} onError={handleImgError} alt={d.name} loading="lazy" decoding="async" className="up-photo absolute inset-0 w-full h-full object-cover" style={{ filter: d.dropStatus === 'upcoming' ? 'blur(12px) brightness(0.6)' : 'none' }} />
                  <div className="absolute top-3 left-3">
                    <span className="border border-border text-fg text-[10px] font-mono font-medium px-2 py-0.5 tracking-widest uppercase bg-bg/80">
                      {d.dropStatus === 'early-access' ? 'Early Access' : 'Locked'}
                    </span>
                  </div>
                  {d.dropStatus !== 'upcoming' && (
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                      <p className="text-sm font-body text-white">{d.name}</p>
                    </div>
                  )}
                </div>
              </ScrollReveal>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
