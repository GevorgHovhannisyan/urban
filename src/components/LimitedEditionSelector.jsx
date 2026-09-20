import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../context/AppContext';
import { useDialogBehavior } from '../hooks/useDialogBehavior';

const formatEdition = (number, total) => `${String(number).padStart(3, '0')} / ${String(total).padStart(3, '0')}`;

// Customer-facing piece-number picker for a Limited Edition product. `total`
// is this product's own real limitedEditionTotal (server/products-api.mjs) —
// never a hardcoded 100, so each limited run can have its own real size.
// Selecting a number here is not a reservation: the backend re-validates
// every chosen number again, atomically, at order-commit time
// (server/edition-api.mjs's claimEditions()). If someone else's order wins
// the race first, checkout surfaces a clear "no longer available" error and
// (CheckoutPage.jsx) sends the shopper back here to pick again — nothing
// this component shows is ever treated as a guarantee by the backend.
export default function LimitedEditionSelector({ productId, total, quantity, value, onChange }) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [sold, setSold] = useState([]);
  const [loading, setLoading] = useState(false);
  const selected = Array.isArray(value) ? value : [];
  const modalRef = useRef(null);
  useDialogBehavior(open, () => setOpen(false), modalRef);

  const loadEditions = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/editions?productId=${encodeURIComponent(productId)}`);
      const data = await response.json();
      if (response.ok) setSold(Array.isArray(data.sold) ? data.sold : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selected.length > quantity) onChange(selected.slice(0, quantity));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantity]);

  useEffect(() => {
    if (open) loadEditions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, productId]);

  const remaining = useMemo(() => Math.max(0, total - sold.length), [sold, total]);

  const toggle = (number) => {
    if (sold.includes(number)) return;
    if (selected.includes(number)) {
      onChange(selected.filter((item) => item !== number));
      return;
    }
    if (selected.length >= quantity) return;
    onChange([...selected, number].sort((a, b) => a - b));
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
            <strong>LIMITED TO {total} PIECES.</strong>
          </div>
        </div>
      </div>

      <p className="limited-edition__prompt">Choose the number that becomes yours.</p>

      <button type="button" className="limited-edition__trigger" onClick={() => setOpen(true)}>
        <span>{selected.length ? 'YOUR PIECE' : t('Select Your Piece')}</span>
        {selected.length > 0 && <span>{selected.map((n) => formatEdition(n, total)).join(', ')}</span>}
      </button>

      <button type="button" className="limited-edition__view-link" onClick={() => setOpen(true)}>
        View available numbers →
      </button>

      {open && createPortal(
        <div ref={modalRef} className="edition-modal" role="dialog" aria-modal="true">
          <button className="edition-modal__overlay" type="button" onClick={() => setOpen(false)} aria-label={t('Close')} />
          <section className="edition-modal__panel">
            <header className="edition-modal__header">
              <div>
                <span>URBAN PHOENIX — LIMITED DROP</span>
                <h2>{t('Select Your Piece')}</h2>
                <p>{t('Choose one number for each item')} ({selected.length}/{quantity}) &nbsp;·&nbsp; {remaining} / {total} remaining</p>
              </div>
              <button type="button" className="edition-modal__close" onClick={() => setOpen(false)} aria-label={t('Close')}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </header>

            {loading ? (
              <div className="edition-modal__loading">Loading…</div>
            ) : (
              <div className="edition-modal__grid">
                {Array.from({ length: total }, (_, index) => index + 1).map((number) => {
                  const isSold = sold.includes(number);
                  const isSelected = selected.includes(number);
                  return (
                    <button
                      key={number}
                      type="button"
                      disabled={isSold || (!isSelected && selected.length >= quantity)}
                      className={`edition-number ${isSold ? 'is-sold' : ''} ${isSelected ? 'is-selected' : ''}`}
                      onClick={() => toggle(number)}
                    >
                      <strong>{String(number).padStart(3, '0')}</strong>
                      <small>{isSold ? t('Sold out') : isSelected ? '✓' : ''}</small>
                    </button>
                  );
                })}
              </div>
            )}

            <footer className="edition-modal__footer">
              <button type="button" className="edition-modal__clear" onClick={() => onChange([])}>{t('Clear')}</button>
              <button
                type="button"
                className="edition-modal__confirm"
                disabled={selected.length !== quantity}
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
