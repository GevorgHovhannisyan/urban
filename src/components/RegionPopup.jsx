import { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { REGION_GROUPS } from '../data/regions';

export default function RegionPopup() {
  const { regionChosen, selectRegion } = useApp();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (regionChosen) return;
    const timer = window.setTimeout(() => setOpen(true), 300);
    return () => window.clearTimeout(timer);
  }, [regionChosen]);

  if (!open || regionChosen) return null;

  const choose = (code) => {
    selectRegion(code);
    setOpen(false);
  };

  return (
    <div className="region-popup-overlay" role="presentation">
      <section
        className="region-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="region-popup-title"
      >
        <div className="region-popup__mark" aria-hidden="true">
          {/* Unlike the navbar's logo, this mark always sits on the modal's
              own opaque surface (never an unpredictable hero photo), so it
              needs none of the navbar's invert+screen photo-compositing
              trick — the source art's native white backdrop is simply
              painted to match via .region-popup__mark's background,
              keeping the black ink legible in both themes. */}
          <img src="/images/brand/up-logo.png" alt="" className="region-popup__mark-img" />
        </div>
        <p className="region-popup__eyebrow">Shipping &amp; pricing</p>
        <h2 id="region-popup-title">Select your country</h2>
        <p className="region-popup__text">
          Urban Phoenix currently ships only to Armenia and the United States. Select yours to see accurate shipping rates and delivery times.
        </p>
        <div className="region-popup__groups">
          {REGION_GROUPS.map((g) => (
            <div className="region-popup__group" key={g.group}>
              <p className="region-popup__group-title">{g.group}</p>
              <ul>
                {g.countries.map((c) => (
                  <li key={c.code}>
                    <button type="button" onClick={() => choose(c.code)}>{c.name}</button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <button type="button" className="region-popup__skip" onClick={() => choose('OTHER')}>
          Continue without selecting
        </button>
      </section>
    </div>
  );
}
