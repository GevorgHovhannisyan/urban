import { useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { REGION_GROUPS } from '../data/regions';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { hasPrivacyChoice, savePrivacyChoice } from '../utils/privacyChoice';

// First-visit dialog: country + cookie choice together, so a new visitor
// sees one modal instead of two stacked ones. The cookie part only shows if
// no choice is stored yet. Picking a country, "Continue without selecting"
// or Escape saves both; the cookie choice defaults to essential-only (no
// optional cookies unless the visitor turns them on).
export default function RegionPopup() {
  const { regionChosen, selectRegion, navigate } = useApp();
  const [open, setOpen] = useState(false);
  const [askPrivacy, setAskPrivacy] = useState(false);
  const [privacyChoice, setPrivacyChoice] = useState('essential');
  const dialogRef = useRef(null);

  useEffect(() => {
    if (regionChosen) return;
    const timer = window.setTimeout(() => {
      setAskPrivacy(!hasPrivacyChoice());
      setOpen(true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [regionChosen]);

  const visible = open && !regionChosen;

  const choose = (code) => {
    if (askPrivacy) savePrivacyChoice(privacyChoice);
    selectRegion(code);
    setOpen(false);
  };

  useDialogBehavior(visible, () => choose('OTHER'), dialogRef, { lockScroll: false, focusContainer: true });

  if (!visible) return null;

  return (
    <div className="region-popup-overlay" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
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
          <img src="/images/brand/up-logo-400.png" alt="" className="region-popup__mark-img" />
        </div>
        <p className="region-popup__eyebrow">Shipping &amp; pricing</p>
        <h2 id="region-popup-title">Select your country</h2>
        <p className="region-popup__text">
          Urban Phoenix currently ships only to Armenia, the United States and Russia. Select yours to see accurate shipping rates and delivery times.
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
        {askPrivacy && (
          <div className="region-popup__privacy" role="group" aria-labelledby="region-popup-privacy-title">
            <p id="region-popup-privacy-title" className="region-popup__eyebrow">Your privacy, your choice</p>
            <p className="region-popup__privacy-text">
              We use essential storage to keep your bag, preferences and checkout working.
              Optional analytics help us understand how the store is used. You can accept all
              cookies or continue with essential storage only.
            </p>
            <div className="region-popup__privacy-actions">
              <button type="button" aria-pressed={privacyChoice === 'all'} onClick={() => setPrivacyChoice('all')}>
                Accept all
              </button>
              <button type="button" aria-pressed={privacyChoice === 'essential'} onClick={() => setPrivacyChoice('essential')}>
                Essential only
              </button>
            </div>
            <button
              type="button"
              className="region-popup__privacy-link"
              onClick={() => {
                choose('OTHER');
                navigate('privacy');
              }}
            >
              Read privacy policy
            </button>
          </div>
        )}
        <button type="button" className="region-popup__skip" onClick={() => choose('OTHER')}>
          Continue without selecting
        </button>
      </section>
    </div>
  );
}
