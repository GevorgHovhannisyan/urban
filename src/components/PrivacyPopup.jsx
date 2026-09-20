import { useEffect, useState } from 'react';

const STORAGE_KEY = 'up_privacy_choice';

export default function PrivacyPopup({ onOpenPrivacy }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      const timer = window.setTimeout(() => setOpen(true), 450);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const saveChoice = (choice) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      choice,
      savedAt: new Date().toISOString(),
    }));
    setOpen(false);
  };

  if (!open) return null;

  return (
    <div className="privacy-popup-overlay" role="presentation">
      <section
        className="privacy-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby="privacy-popup-title"
      >
        <div className="privacy-popup__mark" aria-hidden="true">
          <img src="/images/brand/up-logo.png" alt="" className="privacy-popup__mark-img" style={{ filter: 'invert(1)', mixBlendMode: 'screen' }} />
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
