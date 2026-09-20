import { useEffect, useMemo, useRef, useState } from 'react';
import { getGarmentExplorer } from '../data/garmentExplorer';
import { handleImgError } from '../utils/imageFallback';
import ScrollReveal from './ScrollReveal';

// Fixed section manifesto — reads the same for every product (matches the
// reference layout: "BUILT WITH INTENTION." + intro line never change per
// hotspot). This is brand voice, not a product claim, so it's safe as
// static copy — the same category as "Built From Chaos" / "Freedom To
// Become" used elsewhere on the site, not a fabricated technical spec.
const MANIFESTO_HEADLINE = ['Built With', 'Intention.'];
const MANIFESTO_INTRO = 'Each Urban Phoenix garment is engineered from the inside out. Select a construction point to explore the details that separate craft from commodity.';

// A hotspot's touch target is always a full 44px square (mobile tap-target
// minimum) — the smaller visible ring/plus inside it is purely cosmetic and
// sized independently via CSS, so shrinking the visual mark never shrinks
// what's actually tappable.
function Hotspot({ hotspot, index, active, pulse, onSelect, setRef }) {
  return (
    <button
      ref={(el) => setRef(hotspot.id, el)}
      type="button"
      className={`ge-hotspot ${active ? 'is-active' : ''} ${pulse ? 'is-pulsing' : ''}`}
      style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
      onClick={() => onSelect(hotspot.id)}
      aria-label={`${hotspot.label}`}
      aria-pressed={active}
    >
      <span className="ge-hotspot__ring" aria-hidden="true">
        <span className="ge-hotspot__plus">+</span>
      </span>
      <span className="ge-hotspot__tag" aria-hidden="true">{hotspot.label}</span>
    </button>
  );
}

// The right-panel spec grid only ever shows a value that's already real,
// verified product data (the same `specs`/`material` a hotspot already
// carries — see src/data/garmentExplorer.js's extraction comments). A
// category with nothing real to show renders an honest placeholder instead
// of a manufactured claim like "Double-layer" or "Chain stitch".
function specCardValue(hotspot) {
  return hotspot.specs?.[0] || hotspot.material || '';
}

export default function GarmentExplorer({ product }) {
  const config = useMemo(() => getGarmentExplorer(product), [product]);
  const hasBack = Boolean(config?.backImage);

  const [view, setView] = useState('front');
  const viewHotspots = useMemo(
    () => (config ? config.hotspots.filter((h) => h.view === view) : []),
    [config, view],
  );
  const [activeId, setActiveId] = useState(() => viewHotspots[0]?.id);
  // Pulse is an affordance for "this is clickable" — once the customer has
  // proven they know that by clicking one, it stops, so it never reads as a
  // permanent decoration.
  const [hasInteracted, setHasInteracted] = useState(false);

  // Proximity reaction: hotspot rings scale up slightly as the pointer
  // approaches, not just on exact hover — reads as the garment "sensing"
  // the cursor. Written straight to each button's style (no setState, no
  // re-render) so it can run every mousemove without fighting React's
  // render cycle; hotspotRefs/frameRef persist across renders via refs.
  const frameRef = useRef(null);
  const hotspotRefs = useRef({});
  const setHotspotRef = (id, el) => { hotspotRefs.current[id] = el; };
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || typeof window === 'undefined') return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const PROXIMITY_RADIUS = 140;
    const handleMove = (e) => {
      const rect = frame.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      Object.values(hotspotRefs.current).forEach((el) => {
        if (!el) return;
        const hx = (parseFloat(el.style.left) / 100) * rect.width;
        const hy = (parseFloat(el.style.top) / 100) * rect.height;
        const dist = Math.hypot(px - hx, py - hy);
        const proximity = Math.max(0, 1 - dist / PROXIMITY_RADIUS);
        el.style.setProperty('--ge-proximity', proximity.toFixed(2));
      });
    };
    const handleLeave = () => {
      Object.values(hotspotRefs.current).forEach((el) => el?.style.setProperty('--ge-proximity', 0));
    };
    frame.addEventListener('mousemove', handleMove, { passive: true });
    frame.addEventListener('mouseleave', handleLeave, { passive: true });
    return () => {
      frame.removeEventListener('mousemove', handleMove);
      frame.removeEventListener('mouseleave', handleLeave);
    };
  }, [view]);

  // A hotspot id carried over from the other view (or the previous product)
  // wouldn't exist in the current set — re-anchor to that view's first
  // hotspot whenever the product or front/back view changes.
  useEffect(() => {
    setActiveId(viewHotspots[0]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, view]);

  if (!config) return null;

  const active = viewHotspots.find((h) => h.id === activeId) || viewHotspots[0];
  if (!active) return null;

  const selectHotspot = (id) => {
    setActiveId(id);
    setHasInteracted(true);
  };

  return (
    <section className="garment-explorer">
      <div className="ge-inner">
      <ScrollReveal>
        <div className="ge-banner">
          <p className="ge-banner__eyebrow">Construction</p>
          <div className="ge-banner__highlight">
            <h2 className="ge-banner__title">Garment Explorer</h2>
          </div>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={120} className="ge-layout">
        {/* Image stage */}
        <div className="ge-stage">
          {hasBack && (
            <div className="ge-view-toggle" role="tablist" aria-label="Front or back view">
              {['front', 'back'].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  className={`ge-view-toggle__btn ${view === v ? 'is-active' : ''}`}
                  onClick={() => setView(v)}
                >
                  {v}
                </button>
              ))}
            </div>
          )}

          <div className="ge-stage__frame" ref={frameRef}>
            <div
              className="ge-stage__zoom"
              style={{ transformOrigin: `${active.x}% ${active.y}%` }}
            >
              <img
                src={config.frontImage}
                onError={handleImgError}
                alt={`${product.name} — front`}
                fetchPriority="high"
                className={`ge-stage__img ${view === 'front' ? 'is-visible' : ''}`}
              />
              {hasBack && (
                <img
                  src={config.backImage}
                  onError={handleImgError}
                  alt={`${product.name} — back`}
                  loading="lazy"
                  className={`ge-stage__img ${view === 'back' ? 'is-visible' : ''}`}
                />
              )}
            </div>

            {viewHotspots.map((hotspot, i) => (
              <Hotspot
                key={hotspot.id}
                hotspot={hotspot}
                index={i}
                active={hotspot.id === active.id}
                pulse={!hasInteracted}
                onSelect={selectHotspot}
                setRef={setHotspotRef}
              />
            ))}

            <p className="ge-stage__hint">Touch or click a point to explore construction</p>
          </div>
        </div>

        {/* Info panel */}
        <div className="ge-panel">
          <p className="ge-panel__eyebrow">Garment Explorer</p>
          <h3 className="ge-panel__headline">
            {MANIFESTO_HEADLINE.map((line) => <span key={line}>{line}</span>)}
          </h3>
          <p className="ge-panel__intro">{MANIFESTO_INTRO}</p>

          <div className="ge-spec-grid">
            {viewHotspots.map((hotspot) => {
              const value = specCardValue(hotspot);
              return (
                <button
                  key={hotspot.id}
                  type="button"
                  className={`ge-spec-card ${hotspot.id === active.id ? 'is-active' : ''}`}
                  onClick={() => selectHotspot(hotspot.id)}
                >
                  <span className="ge-spec-card__label">{hotspot.label}</span>
                  <span className="ge-spec-card__value">{value || 'Details coming soon'}</span>
                </button>
              );
            })}
          </div>

          <div className="ge-category-row">
            {viewHotspots.map((hotspot) => (
              <button
                key={hotspot.id}
                type="button"
                className={`ge-category-btn ${hotspot.id === active.id ? 'is-active' : ''}`}
                onClick={() => selectHotspot(hotspot.id)}
              >
                {hotspot.label}
              </button>
            ))}
          </div>
        </div>
      </ScrollReveal>
      </div>
    </section>
  );
}
