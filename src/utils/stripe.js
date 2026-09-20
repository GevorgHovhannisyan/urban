import { loadStripe } from '@stripe/stripe-js';

// The publishable key isn't secret, but it's served from the backend (via
// .env) rather than baked into the frontend build, so it can be rotated
// without a rebuild — same pattern as every other Stripe config value here.
let stripePromise = null;
export function getStripePromise() {
  if (!stripePromise) {
    stripePromise = fetch('/api/config')
      .then((res) => res.json())
      .then((data) => (data.stripePublishableKey ? loadStripe(data.stripePublishableKey) : null));
  }
  return stripePromise;
}

// Matches the storefront's active theme so the embedded card form doesn't
// look like a foreign widget dropped onto the page. Stripe Elements has no
// way to read our CSS custom properties, so these mirror the dark/light
// token values in index.css by hand — keep them in sync if those change.
export function getStripeAppearance(theme) {
  const isLight = theme === 'light';
  return {
    theme: isLight ? 'stripe' : 'night',
    variables: {
      colorPrimary: '#C65D1E',
      colorBackground: isLight ? '#FFFDF9' : '#141414',
      colorText: isLight ? '#17140F' : '#F5F5F3',
      colorDanger: isLight ? '#B0271F' : '#E5484D',
      fontFamily: "'DM Sans', sans-serif",
      borderRadius: '0px',
      spacingUnit: '4px',
    },
    rules: {
      '.Input': { border: `1px solid ${isLight ? 'rgba(23,20,15,0.16)' : 'rgba(255,255,255,0.14)'}` },
      '.Input:focus': { border: '1px solid #C65D1E', boxShadow: 'none' },
      '.Label': {
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.15em',
        color: isLight ? 'rgba(23,20,15,0.55)' : 'rgba(245,245,243,0.5)',
      },
    },
  };
}
