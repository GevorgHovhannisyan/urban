import { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Block } from '../Skeleton';

const LANGUAGES = [{ value: 'en', label: 'English' }, { value: 'hy', label: 'Հայերեն' }, { value: 'ru', label: 'Русский' }];
const CURRENCIES = ['USD', 'AMD', 'EUR'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export default function AccountPreferences() {
  const { accountFetch, setLanguage, setCurrency } = useApp();
  const [prefs, setPrefs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    accountFetch('/preferences')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPrefs(d.preferences))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (next) => {
    const previous = prefs;
    setPrefs(next);
    setSaving(true);
    setMessage('');
    try {
      const res = await accountFetch('/preferences', { method: 'PUT', body: JSON.stringify(next) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save your preferences.');
      setLanguage(data.preferences.language);
      setCurrency(data.preferences.currency);
      setMessage('Preferences saved.');
      setTimeout(() => setMessage(''), 2000);
    } catch (error) {
      setPrefs(previous);
      setMessage(error.message || 'Could not save your preferences. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !prefs) {
    return (
      <div className="max-w-lg space-y-8">
        <Block className="h-8 w-40" />
        <div className="flex gap-2"><Block className="h-9 w-20" /><Block className="h-9 w-20" /><Block className="h-9 w-20" /></div>
        <Block className="h-16 w-full" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-10">
      <h2 className="text-2xl font-display font-black uppercase">Preferences</h2>

      <div>
        <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-3">Language</p>
        <div className="flex gap-2">
          {LANGUAGES.map((l) => (
            <button key={l.value} onClick={() => save({ ...prefs, language: l.value })}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-widest border ${prefs.language === l.value ? 'border-fg bg-fg/10' : 'border-border text-muted'}`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-3">Currency</p>
        <div className="flex gap-2">
          {CURRENCIES.map((c) => (
            <button key={c} onClick={() => save({ ...prefs, currency: c })}
              className={`px-4 py-2 text-xs font-mono uppercase tracking-widest border ${prefs.currency === c ? 'border-fg bg-fg/10' : 'border-border text-muted'}`}>
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <ToggleRow label="Email communications" value={prefs.emailComms} onChange={(v) => save({ ...prefs, emailComms: v })} />
        <ToggleRow label="Product / drop updates" value={prefs.dropUpdates} onChange={(v) => save({ ...prefs, dropUpdates: v })} />
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <div>
          <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-3">Preferred T-Shirt Size</p>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <button key={s} onClick={() => save({ ...prefs, preferredTshirtSize: s })}
                className={`w-10 h-10 text-xs font-mono border ${prefs.preferredTshirtSize === s ? 'border-fg bg-fg/10' : 'border-border text-muted'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] font-mono text-muted tracking-widest uppercase mb-3">Preferred Hoodie Size</p>
          <div className="flex flex-wrap gap-2">
            {SIZES.map((s) => (
              <button key={s} onClick={() => save({ ...prefs, preferredHoodieSize: s })}
                className={`w-10 h-10 text-xs font-mono border ${prefs.preferredHoodieSize === s ? 'border-fg bg-fg/10' : 'border-border text-muted'}`}>
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      <p className="text-xs font-mono text-muted h-4">{saving ? 'Saving…' : message}</p>
    </div>
  );
}

function ToggleRow({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-4">
      <p className="text-sm">{label}</p>
      <button
        onClick={() => onChange(!value)}
        className={`w-12 h-6 rounded-full relative transition-colors ${value ? 'bg-accent' : 'bg-fg/15'}`}
        aria-pressed={value}
      >
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${value ? 'translate-x-6' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}
