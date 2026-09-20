import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Block } from '../Skeleton';

export default function AccountRewards() {
  const { accountFetch, navigate } = useApp();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    accountFetch('/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <Block className="h-40" />;
  if (!data) return <p className="text-muted text-sm">Could not load your rewards right now.</p>;

  const points = data.loyaltyPoints || 0;
  const pointsToNextReward = 100 - (points % 100);
  const progressPct = ((points % 100) / 100) * 100;

  return (
    <div className="space-y-10">
      <div>
        <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-2">UP Society</p>
        <h2 className="text-4xl lg:text-5xl font-display font-black uppercase leading-none mb-3">Rewards</h2>
        <p className="text-sm text-muted max-w-md">Earn 1 point for every $1 spent. Every 100 points unlocks $5 off a future order — applied automatically at checkout.</p>
      </div>

      <div className="border border-border p-6 lg:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-1">UP Points Balance</p>
            <p key={points} className="text-5xl font-display font-black">{points.toLocaleString()}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-mono text-muted tracking-[.2em] uppercase mb-1">Redeemable Value</p>
            <p key={data.loyaltyPointsValue} className="text-2xl font-mono text-accent-light">${data.loyaltyPointsValue || 0}</p>
          </div>
        </div>
        <div className="h-1.5 bg-fg/10 overflow-hidden mb-2">
          <div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${progressPct}%` }} />
        </div>
        <p key={pointsToNextReward} className="text-[11px] font-mono text-muted">
          {pointsToNextReward} points to your next $5 reward
        </p>
      </div>

      <button onClick={() => navigate('shop')} className="btn-primary px-8 py-4 text-[11px] font-mono uppercase tracking-widest">
        Shop &amp; Earn Points
      </button>
    </div>
  );
}
