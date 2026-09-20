import { useEffect, useMemo, useRef, useState } from 'react';
import { COUNTRIES, getCountryName } from '../data/countries';

// Searchable country combobox — replaces every hardcoded 5-option
// (Armenia/United States/France/Germany/"Other international") <select>
// across the storefront. `value` is always a real ISO 3166-1 alpha-2 code
// (or, for a legacy saved address created before this existed, whatever
// full-name string was already stored — getCountryName() displays either
// correctly); `onChange` is always called with the newly selected code.
// There is deliberately no non-country placeholder option — every shopper
// selects their own real country, which is what ends up stored on the
// order/address (see server/delivery.mjs and server/order-api.mjs).
//
// `countries` controls which options are actually offered — defaults to the
// full worldwide list (used for a customer's own profile country, e.g.
// AuthPage.jsx/AccountProfile.jsx). A real shipping destination
// (CheckoutPage.jsx / AccountAddresses.jsx) passes
// SUPPORTED_SHIPPING_COUNTRIES instead, so a customer can only ever select
// a country Urban Phoenix actually ships to — searching for an unsupported
// country there simply finds nothing, it's never offered as a choice.
export default function CountrySelect({ value, onChange, id, name, required, placeholder = 'Country', countries = COUNTRIES }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selectedName = value ? getCountryName(value) : '';

  // The input shows the search query while open/being edited, and the
  // selected country's real name the rest of the time — never the raw code.
  const displayValue = open ? query : selectedName;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter((c) => c.name.toLowerCase().includes(q));
  }, [query, countries]);

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  useEffect(() => {
    setHighlighted(0);
  }, [query, open]);

  useEffect(() => {
    if (open) listRef.current?.children[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  const select = (country) => {
    onChange(country.code);
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (event) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'Enter')) {
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
      event.preventDefault();
      if (filtered[highlighted]) select(filtered[highlighted]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery('');
    }
  };

  return (
    <div className="relative" ref={rootRef}>
      {/* The visible input is a search/display field only — its own value
          is never the source of truth. A plain hidden input carries the
          real code under `name` so any caller reading this via native
          FormData (e.g. AuthPage.jsx's registration form) gets the code,
          exactly like every controlled (value/onChange) caller does. */}
      {name && <input type="hidden" name={name} value={value || ''} />}
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls={id ? `${id}-listbox` : undefined}
        autoComplete="off"
        required={required}
        placeholder={placeholder}
        className="up-input"
        value={displayValue}
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={(event) => { setOpen(true); setQuery(event.target.value); }}
        onKeyDown={handleKeyDown}
      />
      {open && (
        <ul
          id={id ? `${id}-listbox` : undefined}
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-surface border border-border shadow-2xl shadow-black/60 z-50"
        >
          {filtered.length === 0 ? (
            <li className="px-4 py-3 text-xs text-muted">No matching country</li>
          ) : (
            filtered.map((country, i) => (
              <li
                key={country.code}
                role="option"
                aria-selected={country.code === value}
                onMouseDown={(event) => { event.preventDefault(); select(country); }}
                onMouseEnter={() => setHighlighted(i)}
                className={`px-4 py-2.5 text-sm cursor-pointer transition-colors ${i === highlighted ? 'bg-[var(--hover-overlay)] text-fg' : 'text-muted'} ${country.code === value ? 'text-accent' : ''}`}
              >
                {country.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
