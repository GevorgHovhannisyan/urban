import { useEffect, useRef, useState } from 'react';
import { useDialogBehavior } from '../hooks/useDialogBehavior';
import { hasPrivacyChoice, savePrivacyChoice } from '../utils/privacyChoice';

// New visitors make this choice inside the first-visit country dialog
// (RegionPopup). This standalone version only appears for visitors who
// already picked a country but never chose (e.g. before the two were
// combined). Escape = "Essential only".
export default function PrivacyPopup({ onOpenPrivacy }) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!hasPrivacyChoice()) {
      const timer = window.setTimeout(() => setOpen(true), 450);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const saveChoice = (choice) => {
    savePrivacyChoice(choice);
    setOpen(false);
  };

  useDialogBehavior(open, () => saveChoice('essential'), dialogRef, { lockScroll: false, focusContainer: true });

  if (!open) return null;

  return (
    <div className="privacy-popup-overlay" role="presentation">
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="privacy-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-popup-title"
      >
        <div className="privacy-popup__mark" aria-hidden="true">
          <img src="/images/brand/up-logo-400.png" alt="" className="privacy-popup__mark-img" style={{ filter: 'invert(1)', mixBlendMode: 'screen' }} />
        </div>
        <p className="privacy-popup__eyebrow">Your privacy, your choice</p>
        <h2 id="privacy-popup-title">A cleaner browsing experience</h2>
        <p className="privacy-popup__text">
          We use essential storage to keep your bag, preferences and checkout working.
          Optional analytics help us understand how the store is used. You can accept all
          cookies or continue with essential storage only.
        </p>
        <div className="privacy-popup__actions">
          <button type="button" className="privacy-popup__primary" onClick={() => saveChoice('all')}>
            Accept all
          </button>
          <button type="button" className="privacy-popup__secondary" onClick={() => saveChoice('essential')}>
            Essential only
          </button>
        </div>
        <button
          type="button"
          className="privacy-popup__link"
          onClick={() => {
            saveChoice('essential');
            onOpenPrivacy?.();
          }}
        >
          Read privacy policy
        </button>
      </section>
    </div>
  );
}
