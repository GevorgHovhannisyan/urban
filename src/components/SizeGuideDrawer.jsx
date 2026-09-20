import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GarmentArtwork from './GarmentArtwork';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { useApp } from '../context/AppContext';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

const CM_TO_INCHES = 0.3937007874;

function toInches(value) {
  return (value * CM_TO_INCHES).toFixed(1);
}

export default function SizeGuideDrawer({
  open,
  onClose,
  product,
  selectedSize,
  selectedColor,
  variantStock,
  onSelectSize,
}) {
  const { content } = useApp();
  // Real per-garment-type measurement table (Admin → Site Content → Size
  // Guide) — a garmentType this table doesn't have an entry for (or no
  // garmentType at all) falls back to tshirt's, matching GarmentArtwork.jsx's
  // own fallback so the illustration and the numbers next to it never
  // disagree about which garment they're describing.
  const measurements = content.sizeGuide[product?.garmentType] || content.sizeGuide.tshirt;

  const offeredSizes = useMemo(() => {
    const sizes = product?.sizes?.filter(size => size !== 'One Size');
    return sizes?.length ? sizes : SIZES;
  }, [product]);

  // A size can be offered by the product at all (offeredSizes) without the
  // currently selected color actually having any left in stock — checking
  // only offeredSizes let this drawer mark a sold-out size/color combination
  // as selectable even though the real add-to-bag control on the page
  // correctly disables it, so "available" here must also consult per-variant
  // stock, exactly like the main product page's size buttons do.
  const availableSizes = useMemo(() => {
    if (!variantStock) return offeredSizes; // no stock data provided — fall back to the old behavior
    return offeredSizes.filter(size => variantStock(size, selectedColor) !== 0);
  }, [offeredSizes, variantStock, selectedColor]);

  const [activeSize, setActiveSize] = useState(
    selectedSize && SIZES.includes(selectedSize) ? selectedSize : 'M',
  );
  const panelRef = useRef(null);
  useDialogBehavior(open, onClose, panelRef);

  useEffect(() => {
    if (!open) return undefined;

    setActiveSize(
      selectedSize && SIZES.includes(selectedSize) ? selectedSize : 'M',
    );

    document.body.classList.add('size-guide-open');
    return () => {
      document.body.classList.remove('size-guide-open');
    };
  }, [open, selectedSize]);

  if (!open) return null;

  const values = measurements[activeSize];
  const isAvailable = availableSizes.includes(activeSize);
  const rows = [
    ['Chest', values.chest],
    ['Front length', values.length],
    ['Sleeve length', values.sleeve],
  ];

  const confirmSize = () => {
    if (!isAvailable) return;
    onSelectSize?.(activeSize);
    onClose?.();
  };

  return createPortal(
    <div className="size-guide-root" role="dialog" aria-modal="true" aria-labelledby="size-guide-title">
      <button
        type="button"
        className="size-guide-overlay"
        onClick={onClose}
        aria-label="Close size guide"
      />

      <aside ref={panelRef} className="size-guide-panel">
        <header className="size-guide-header">
          <div className="size-guide-heading-row">
            <div>
              <p className="size-guide-eyebrow">Urban Phoenix / Fit System</p>
              <h2 id="size-guide-title" className="size-guide-title">Size Guide</h2>
            </div>

            <button type="button" className="size-guide-close" onClick={onClose} aria-label="Close size guide">
              <svg viewBox="0 0 32 32" aria-hidden="true">
                <path d="M7 7l18 18M25 7L7 25" />
              </svg>
            </button>
          </div>

          <div className="size-guide-tabs" aria-label="Measurement type">
            <span>Item</span>
          </div>
        </header>

        <div className="size-guide-content">
          <section className="size-guide-visual-section">
            <div className="size-guide-measure-layout">
              <GarmentArtwork garmentType={product?.garmentType || 'tshirt'} />

              <div className="size-guide-instructions">
                {[
                  ['A', 'Chest', 'Measure from side to side at armhole height.'],
                  ['B', 'Front length', 'Measure from the highest shoulder point to the bottom of the garment.'],
                  ['C', 'Sleeve length', 'Measure from the shoulder seam to the end of the sleeve.'],
                ].map(([letter, title, text]) => (
                  <div className="size-guide-instruction" key={letter}>
                    <span>{letter}</span>
                    <div>
                      <strong>{title}</strong>
                      <p>{text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <p className="size-guide-note">
              Item measurements are taken with the garment laid flat.<br />
              A production tolerance of ±1–2 cm may occur.
            </p>
          </section>

          <section className="size-guide-selection-section">
            <h3 className="size-guide-section-title">Select a size</h3>

            <div className="size-guide-size-list" aria-label="Available sizes">
              {SIZES.map(size => {
                const available = availableSizes.includes(size);
                return (
                  <button
                    key={size}
                    type="button"
                    className={[
                      activeSize === size ? 'is-active' : '',
                      available ? '' : 'is-sold-out',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setActiveSize(size)}
                    aria-pressed={activeSize === size}
                    aria-label={`${size}${available ? '' : ', out of stock'}`}
                  >
                    {size}
                  </button>
                );
              })}
            </div>

            <div className="size-guide-table-head" aria-hidden="true">
              <span>Zone</span>
              <span>CM</span>
              <span>Inches</span>
            </div>

            <div className="size-guide-table-body">
              {rows.map(([label, value]) => (
                <div className="size-guide-table-row" key={label}>
                  <span>{label}</span>
                  <strong>{value.toFixed(1)}</strong>
                  <em>{toInches(value)}</em>
                </div>
              ))}
            </div>

            <button
              type="button"
              className={`size-guide-stock-button ${isAvailable ? 'is-available' : 'is-unavailable'}`}
              disabled={!isAvailable}
              onClick={confirmSize}
            >
              {isAvailable ? `Select ${activeSize}` : `${activeSize} — Out of stock`}
            </button>
          </section>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
