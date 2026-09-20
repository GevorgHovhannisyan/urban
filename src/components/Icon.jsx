// Shared line-icon set — every icon site-wide (Navbar, TrustBar) uses the
// same stroke style (viewBox 24, fill none, currentColor stroke, round
// caps/joins); this centralizes new icons in that same style instead of
// pasting raw <svg> markup at each call site.
const PATHS = {
  instagram: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.4" cy="6.6" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  tiktok: (
    <path d="M14 3v10.5a3.3 3.3 0 1 1-3.3-3.3c.3 0 .6 0 .9.1V7.1a6.6 6.6 0 1 0 5.7 6.5V9.3a7.6 7.6 0 0 0 4.2 1.3V7.4a4.3 4.3 0 0 1-3.4-1.6A4.3 4.3 0 0 1 17.1 3z" />
  ),
  twitter: (
    <path d="M4 4l8 10.6L4.3 20H6l6.9-5.4L18.5 20H21l-8.3-11L20 4h-1.7l-6.4 5L7.5 4z" />
  ),
  truck: (
    <path d="M3 7h11v10H3zM14 10h4l3 3v4h-7zM7 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
  ),
  returns: <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 2.5l7.5 3v6c0 5-3.2 8.4-7.5 10-4.3-1.6-7.5-5-7.5-10v-6z" />
      <path d="M8.7 12.2l2.2 2.2 4.4-4.4" />
    </>
  ),
  wallet: (
    <>
      <path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <path d="M16 12.5h3v3h-3a1.5 1.5 0 0 1 0-3z" />
    </>
  ),
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  mobile: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2" />
      <path d="M11 18.5h2" />
    </>
  ),
  envelope: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.7 4.7l1.85 1.85M17.45 17.45l1.85 1.85M2.5 12h2.6M18.9 12h2.6M4.7 19.3l1.85-1.85M17.45 6.55l1.85-1.85" />
    </>
  ),
  moon: (
    <path d="M20.5 14.6A8.7 8.7 0 1 1 9.4 3.5a7 7 0 0 0 11.1 11.1z" />
  ),
};

export default function Icon({ name, size = 20, strokeWidth = 1.6, className = '' }) {
  const path = PATHS[name];
  if (!path) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {path}
    </svg>
  );
}
