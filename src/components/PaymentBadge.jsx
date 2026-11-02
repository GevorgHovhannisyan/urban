// Official payment marks (public/images/payments/ — Visa 2021, Mastercard
// 2019 symbol, American Express 2018 "blue box", ArCa wordmark), each shown
// on the same small white card so every logo keeps its real brand colours
// and stays legible on both the light and dark themes.
const BADGES = {
  visa: { src: '/images/payments/visa.svg', alt: 'Visa', padding: '4px 6px' },
  mastercard: { src: '/images/payments/mastercard.svg', alt: 'Mastercard', padding: '3px 7px' },
  amex: { src: '/images/payments/amex.svg', alt: 'American Express', padding: '0', fill: true },
  arca: { src: '/images/payments/arca.png', alt: 'ArCa', padding: '4px 5px' },
};

export default function PaymentBadge({ name, className = '' }) {
  const badge = BADGES[name];
  if (!badge) return null;
  return (
    <span
      className={`inline-flex items-center justify-center bg-white rounded-[3px] border border-black/10 overflow-hidden w-[38px] h-[24px] ${className}`}
      style={{ padding: badge.padding }}
    >
      <img
        src={badge.src}
        alt={badge.alt}
        title={badge.alt}
        loading="lazy"
        draggable="false"
        className={badge.fill ? 'w-full h-full object-cover' : 'max-w-full max-h-full object-contain'}
      />
    </span>
  );
}
