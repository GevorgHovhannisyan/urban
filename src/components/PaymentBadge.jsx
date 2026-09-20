// Payment marks need brand-color recognition (a grey outline "VISA" reads as
// nothing at a glance) — unlike the site's line icons, these use each
// network's real palette. Mastercard's interlocking circles are simple/
// iconic enough to draw as real shapes; the rest are compact wordmark chips,
// which is the standard approach every payment-icon set uses rather than
// redrawing full brand logos.
const BADGES = {
  visa: { bg: '#1A1F71', text: 'VISA', style: { fontStyle: 'italic', letterSpacing: '0.02em' } },
  mastercard: { render: () => (
    <svg width="28" height="17" viewBox="0 0 28 17" aria-hidden="true">
      <circle cx="11" cy="8.5" r="8" fill="#EB001B" />
      <circle cx="17" cy="8.5" r="8" fill="#F79E1B" />
      <path d="M14 2.7a8 8 0 0 1 0 11.6 8 8 0 0 1 0-11.6z" fill="#FF5F00" />
    </svg>
  ) },
  amex: { bg: '#006FCF', text: 'AMEX' },
  paypal: { bg: '#003087', text: 'PayPal', style: { fontStyle: 'italic' } },
  idram: { bg: '#00A9E0', text: 'Idram' },
};

export default function PaymentBadge({ name, className = '' }) {
  const badge = BADGES[name];
  if (!badge) return null;
  if (badge.render) {
    return <span className={`inline-flex items-center justify-center bg-white rounded-[2px] px-1 ${className}`}>{badge.render()}</span>;
  }
  return (
    <span
      className={`inline-flex items-center justify-center text-white text-[9px] font-bold tracking-wide px-2 h-[17px] rounded-[2px] ${className}`}
      style={{ backgroundColor: badge.bg, ...badge.style }}
    >
      {badge.text}
    </span>
  );
}
