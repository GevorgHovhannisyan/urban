import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getCities } from '../data/cities';

// City combobox for shipping addresses (CheckoutPage.jsx / AccountAddresses.jsx).
// Focusing the field immediately lists every suggested city/region for the
// selected `country` (src/data/cities.js) — no typing required — and typing
// filters by city or region name. Unlike CountrySelect, the typed text IS the
// value: a city missing from the suggestions can still be entered as-is, so
// the list only ever helps, never blocks.
export default function CitySelect({ country, value, onChange, name = 'city', placeholder = 'City', error, required, className = '' }) {
  const [open, setOpen] = useState(false);
  // Until the customer types, show the full list even if a city is already
  // filled in — so clicking the field always shows every option.
  const [typed, setTyped] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const cities = useMemo(() => getCities(country), [country]);

  const filtered = useMemo(() => {
    const q = typed ? String(value || '').trim().toLowerCase() : '';
    if (!q) return cities;
    const starts = [];
    const contains = [];
    for (const c of cities) {
      const n = c.name.toLowerCase();
      if (n.startsWith(q)) starts.push(c);
      else if (n.includes(q) || c.region.toLowerCase().includes(q)) contains.push(c);
    }
    return [...starts, ...contains];
  }, [cities, value, typed]);

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  useEffect(() => { setHighlighted(0); }, [value, open, country]);

  useEffect(() => {
    if (open) listRef.current?.children[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  const emit = (next) => onChange({ target: { name, value: next } });

  const select = (city) => {
    emit(city.name);
    setOpen(false);
    setTyped(false);
  };

  const handleKeyDown = (event) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlighted((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      if (filtered[highlighted]) {
        event.preventDefault();
        select(filtered[highlighted]);
      }
    } else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
    }
  };

  const showList = open && cities.length > 0;

  return (
    <label className={`relative block ${className}`} ref={rootRef}>
      <span className="sr-only">{placeholder}</span>
      <input
        name={name}
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${name}-error` : undefined}
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        className={`up-input pr-10 ${error ? 'has-error' : ''}`}
        value={value || ''}
        onFocus={() => { setOpen(true); setTyped(false); }}
        onClick={() => setOpen(true)}
        onChange={(event) => { setOpen(true); setTyped(true); emit(event.target.value); }}
        onKeyDown={handleKeyDown}
      />
      {cities.length > 0 && (
        <svg className={`pointer-events-none absolute right-4 top-[22px] -translate-y-1/2 text-muted transition-transform ${showList ? 'rotate-180' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      )}
      {showList && (
        <ul
          id={listId}
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-surface border border-border shadow-2xl shadow-black/60 z-50"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-xs text-muted">No match in the list — you can keep typing your city.</li>
          ) : (
            filtered.map((city, i) => {
              const isCurrent = city.name.toLowerCase() === String(value || '').trim().toLowerCase();
              return (
                <li
                  key={`${city.name}|${city.region}`}
                  role="option"
                  aria-selected={isCurrent}
                  onMouseDown={(event) => { event.preventDefault(); select(city); }}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm cursor-pointer transition-colors ${i === highlighted ? 'bg-[var(--hover-overlay)] text-fg' : 'text-muted'} ${isCurrent ? 'text-accent' : ''}`}
                >
                  <span>{city.name}</span>
                  {city.region !== city.name && <span className="text-[11px] text-muted/70 shrink-0">{city.region}</span>}
                </li>
              );
            })
          )}
        </ul>
      )}
      {error && <span id={`${name}-error`} className="checkout-field-error">{error}</span>}
    </label>
  );
}
