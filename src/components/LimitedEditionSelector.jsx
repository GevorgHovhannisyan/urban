import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { useDialogBehavior } from '../hooks/useDialogBehavior';

const pad = (number) => String(number).padStart(3, '0');

// Customer-facing piece-number picker for a Limited Edition product. `total`
// is this product's own real limitedEditionTotal (server/products-api.mjs) —
// never a hardcoded 100, so each limited run can have its own real size.
// Selecting a number here is not a reservation: the backend re-validates
// every chosen number again, atomically, at order-commit time
// (server/edition-api.mjs's claimEditions()). If someone else's order wins
// the race first, checkout surfaces a clear "no longer available" error and
// (CheckoutPage.jsx) sends the shopper back here to pick again — nothing
// this component shows is ever treated as a guarantee by the backend.
// `reserved`: numbers of this product already in the shopper's bag — shown
// as taken so the same serial can't be picked twice across bag lines.
export default function LimitedEditionSelector({ productId, total, quantity, value, onChange, error = false, reserved = [] }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [sold, setSold] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const selected = Array.isArray(value) ? value : [];
  const modalRef = useRef(null);
  useDialogBehavior(open, () => setOpen(false), modalRef);

  // `quiet` refreshes (polling) never flash the loading state.
  const loadEditions = async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch(`/api/editions?productId=${encodeURIComponent(productId)}`, { cache: 'no-store' });
      const data = await response.json();
      if (response.ok) setSold(Array.isArray(data.sold) ? data.sold : []);
    } catch {
      // Availability is a convenience here — checkout re-validates anyway.
    } finally {
      if (!quiet) setLoading(false);
    }
  };

  useEffect(() => {
    if (selected.length > quantity) onChange(selected.slice(0, quantity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity]);

  // Loaded up front (for the "X left" count on the page) and refreshed every
  // time the picker opens, so the grid never shows stale availability.
  useEffect(() => {
    loadEditions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);
  useEffect(() => {
    if (open) loadEditions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Live availability: serials an admin marks sold out / available (or that
  // another customer buys) show up here without a reload — polled faster
  // while the picker is open, and refreshed whenever the tab regains focus.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') loadEditions({ quiet: true }); };
    const timer = setInterval(refresh, open ? 5000 : 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  // A number the customer already picked that has since become unavailable
  // is dropped from their selection, with a visible explanation.
  useEffect(() => {
    if (!sold || !selected.length) return;
    const gone = selected.filter((n) => sold.includes(n));
    if (!gone.length) return;
    onChange(selected.filter((n) => !sold.includes(n)));
    setNotice(`${gone.map(pad).join(', ')} ${gone.length === 1 ? 'is' : 'are'} no longer available — please choose another number.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sold]);

  const soldList = useMemo(() => [...new Set([...(sold || []), ...reserved])], [sold, reserved]);
  const remaining = useMemo(() => Math.max(0, total - soldList.length), [soldList, total]);
  const isComplete = selected.length === quantity;

  const toggle = (number) => {
    if (soldList.includes(number)) return;
    if (selected.includes(number)) {
      onChange(selected.filter((item) => item !== number));
      return;
    }
    // Already picked enough — swap out the most recent pick instead of
    // blocking the tap, so changing your mind is a single click.
    const base = selected.length >= quantity ? selected.slice(0, quantity - 1) : selected;
    setNotice('');
    onChange([...base, number].sort((a, b) => a - b));
  };

  const pickRandom = () => {
    const free = Array.from({ length: total }, (_, i) => i + 1)
      .filter((n) => !soldList.includes(n) && !selected.includes(n));
    const needed = quantity - selected.length;
    if (needed <= 0 || free.length === 0) return;
    const picks = [];
    for (let i = 0; i < needed && free.length; i += 1) {
      picks.push(free.splice(Math.floor(Math.random() * free.length), 1)[0]);
    }
    onChange([...selected, ...picks].sort((a, b) => a - b));
  };

  return (
    <div className="limited-edition">
      <div className="limited-edition__heading">
        <div className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c65d1e" strokeWidth="1.6" aria-hidden="true">
            <circle cx="12" cy="8" r="6" /><path d="M9 13.5 7 22l5-3 5 3-2-8.5" />
          </svg>
          <div>
            <span className="limited-edition__eyebrow">LIMITED EDITION</span>
            <strong>{`LIMITED TO ${total} PIECES.`}</strong>
          </div>
        </div>
        {sold && (
          <span className="limited-edition__remaining">
            {remaining} / {total} <span>{t('left')}</span>
          </span>
        )}
      </div>

      <p className="limited-edition__prompt">
        {t('Every piece is individually numbered. Choose yours before adding to bag.')}
      </p>

      <button
        type="button"
        className={`limited-edition__trigger ${selected.length ? 'is-chosen' : ''} ${error ? 'is-error' : ''}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        <span className="limited-edition__badge" aria-hidden="true">#</span>
        <span className="limited-edition__trigger-text">
          {selected.length ? (
            <>
              <small>{t('Your Number')}</small>
              <span className="limited-edition__numbers">
                {selected.map((n) => (
                  <span key={n}>{pad(n)}<em> / {pad(total)}</em></span>
                ))}
              </span>
            </>
          ) : (
            <>
              <span className="limited-edition__cta">{t('Choose Your Number')}</span>
              <small>{t('Tap to see which numbers are still available')}</small>
            </>
          )}
        </span>
        <span className="limited-edition__action">
          {selected.length ? t('Change') : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          )}
        </span>
      </button>

      {notice && <p className="limited-edition__notice" role="status">{notice}</p>}

      {open && createPortal(
        <div ref={modalRef} className="edition-modal" role="dialog" aria-modal="true" aria-label={t('Choose Your Number')}>
          <button className="edition-modal__overlay" type="button" onClick={() => setOpen(false)} aria-label={t('Close')} />
          <section className="edition-modal__panel">
            <header className="edition-modal__header">
              <div>
                <span>URBAN PHOENIX — LIMITED DROP</span>
                <h2>{t('Choose Your Number')}</h2>
                <p>
                  <span>{t('Choose one number for each item')}</span>
                  <span className="edition-modal__count"> {selected.length}/{quantity}</span>
                  {sold && <span> · {remaining} / {total} <span>{t('available')}</span></span>}
                </p>
              </div>
              <button type="button" className="edition-modal__close" onClick={() => setOpen(false)} aria-label={t('Close')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            {notice && <p className="edition-modal__notice" role="status">{notice}</p>}

            <div className="edition-modal__legend">
              <span><i className="edition-swatch" />{t('Available')}</span>
              <span><i className="edition-swatch is-selected" />{t('Your pick')}</span>
              <span><i className="edition-swatch is-sold" />{t('Taken')}</span>
              <button type="button" className="edition-modal__random" onClick={pickRandom} disabled={loading || isComplete || remaining === 0}>
                {t('Pick for me')}
              </button>
            </div>

            {loading && !sold ? (
              <div className="edition-modal__loading">Loading…</div>
            ) : (
              <div className="edition-modal__grid">
                {Array.from({ length: total }, (_, index) => index + 1).map((number) => {
                  const isSold = soldList.includes(number);
                  const isSelected = selected.includes(number);
                  return (
                    <button
                      key={number}
                      type="button"
                      disabled={isSold}
                      aria-pressed={isSelected}
                      aria-label={`${pad(number)}${isSold ? ` — ${t('Taken')}` : ''}`}
                      className={`edition-number ${isSold ? 'is-sold' : ''} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => toggle(number)}
                    >
                      <strong>{pad(number)}</strong>
                      {isSelected && <small aria-hidden="true">✓</small>}
                    </button>
                  );
                })}
              </div>
            )}

            <footer className="edition-modal__footer">
              <button type="button" className="edition-modal__clear" onClick={() => onChange([])} disabled={!selected.length}>{t('Clear')}</button>
              <button
                type="button"
                className="edition-modal__confirm"
                disabled={!isComplete}
                onClick={() => setOpen(false)}
              >
                {t('Confirm Selection')} ({selected.length}/{quantity})
              </button>
            </footer>
          </section>
        </div>,
        document.body
      )}
    </div>
  );
}
