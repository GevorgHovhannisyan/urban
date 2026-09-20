// The ONE list of real-world countries this app knows the name of — both
// the frontend (CountrySelect.jsx and every profile form that used to
// hardcode a 5-option <select>) and backend (server/mailer.mjs's address
// display) import from this single file, same pattern already used for
// shipping rules (src/data/shippingRules.js).
//
// This is the full, standard ISO 3166-1 alpha-2 list — used for a
// customer's own PROFILE country (AuthPage.jsx/AccountProfile.jsx; not a
// shipping destination, so not restricted) and for displaying the name of
// whatever country ended up on any order/address, historical or current.
// It is NOT what controls where Urban Phoenix actually ships — see
// SUPPORTED_SHIPPING_COUNTRIES below for that (currently just Armenia and
// the United States); CheckoutPage.jsx and AccountAddresses.jsx (real
// shipping destinations) restrict their <CountrySelect> to that list
// instead of this one.
//
// Stored internally as the 2-letter `code` (e.g. "US", "FR", "DE", "AM");
// `name` is what's ever shown to a customer. getCountryName() below is the
// shared code -> name lookup used everywhere a country is displayed.
export const COUNTRIES = [
  { code: 'AF', name: 'Afghanistan' }, { code: 'AL', name: 'Albania' }, { code: 'DZ', name: 'Algeria' },
  { code: 'AD', name: 'Andorra' }, { code: 'AO', name: 'Angola' }, { code: 'AG', name: 'Antigua and Barbuda' },
  { code: 'AR', name: 'Argentina' }, { code: 'AM', name: 'Armenia' }, { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' }, { code: 'AZ', name: 'Azerbaijan' }, { code: 'BS', name: 'Bahamas' },
  { code: 'BH', name: 'Bahrain' }, { code: 'BD', name: 'Bangladesh' }, { code: 'BB', name: 'Barbados' },
  { code: 'BY', name: 'Belarus' }, { code: 'BE', name: 'Belgium' }, { code: 'BZ', name: 'Belize' },
  { code: 'BJ', name: 'Benin' }, { code: 'BT', name: 'Bhutan' }, { code: 'BO', name: 'Bolivia' },
  { code: 'BA', name: 'Bosnia and Herzegovina' }, { code: 'BW', name: 'Botswana' }, { code: 'BR', name: 'Brazil' },
  { code: 'BN', name: 'Brunei' }, { code: 'BG', name: 'Bulgaria' }, { code: 'BF', name: 'Burkina Faso' },
  { code: 'BI', name: 'Burundi' }, { code: 'KH', name: 'Cambodia' }, { code: 'CM', name: 'Cameroon' },
  { code: 'CA', name: 'Canada' }, { code: 'CV', name: 'Cape Verde' }, { code: 'CF', name: 'Central African Republic' },
  { code: 'TD', name: 'Chad' }, { code: 'CL', name: 'Chile' }, { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' }, { code: 'KM', name: 'Comoros' }, { code: 'CR', name: 'Costa Rica' },
  { code: 'HR', name: 'Croatia' }, { code: 'CU', name: 'Cuba' }, { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czech Republic' }, { code: 'CD', name: 'Democratic Republic of the Congo' }, { code: 'DK', name: 'Denmark' },
  { code: 'DJ', name: 'Djibouti' }, { code: 'DM', name: 'Dominica' }, { code: 'DO', name: 'Dominican Republic' },
  { code: 'EC', name: 'Ecuador' }, { code: 'EG', name: 'Egypt' }, { code: 'SV', name: 'El Salvador' },
  { code: 'GQ', name: 'Equatorial Guinea' }, { code: 'ER', name: 'Eritrea' }, { code: 'EE', name: 'Estonia' },
  { code: 'SZ', name: 'Eswatini' }, { code: 'ET', name: 'Ethiopia' }, { code: 'FJ', name: 'Fiji' },
  { code: 'FI', name: 'Finland' }, { code: 'FR', name: 'France' }, { code: 'GA', name: 'Gabon' },
  { code: 'GM', name: 'Gambia' }, { code: 'GE', name: 'Georgia' }, { code: 'DE', name: 'Germany' },
  { code: 'GH', name: 'Ghana' }, { code: 'GR', name: 'Greece' }, { code: 'GD', name: 'Grenada' },
  { code: 'GT', name: 'Guatemala' }, { code: 'GN', name: 'Guinea' }, { code: 'GW', name: 'Guinea-Bissau' },
  { code: 'GY', name: 'Guyana' }, { code: 'HT', name: 'Haiti' }, { code: 'HN', name: 'Honduras' },
  { code: 'HK', name: 'Hong Kong' }, { code: 'HU', name: 'Hungary' }, { code: 'IS', name: 'Iceland' },
  { code: 'IN', name: 'India' }, { code: 'ID', name: 'Indonesia' }, { code: 'IR', name: 'Iran' },
  { code: 'IQ', name: 'Iraq' }, { code: 'IE', name: 'Ireland' }, { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' }, { code: 'CI', name: 'Ivory Coast' }, { code: 'JM', name: 'Jamaica' },
  { code: 'JP', name: 'Japan' }, { code: 'JO', name: 'Jordan' }, { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KE', name: 'Kenya' }, { code: 'KI', name: 'Kiribati' }, { code: 'KW', name: 'Kuwait' },
  { code: 'KG', name: 'Kyrgyzstan' }, { code: 'LA', name: 'Laos' }, { code: 'LV', name: 'Latvia' },
  { code: 'LB', name: 'Lebanon' }, { code: 'LS', name: 'Lesotho' }, { code: 'LR', name: 'Liberia' },
  { code: 'LY', name: 'Libya' }, { code: 'LI', name: 'Liechtenstein' }, { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' }, { code: 'MO', name: 'Macau' }, { code: 'MG', name: 'Madagascar' },
  { code: 'MW', name: 'Malawi' }, { code: 'MY', name: 'Malaysia' }, { code: 'MV', name: 'Maldives' },
  { code: 'ML', name: 'Mali' }, { code: 'MT', name: 'Malta' }, { code: 'MH', name: 'Marshall Islands' },
  { code: 'MR', name: 'Mauritania' }, { code: 'MU', name: 'Mauritius' }, { code: 'MX', name: 'Mexico' },
  { code: 'FM', name: 'Micronesia' }, { code: 'MD', name: 'Moldova' }, { code: 'MC', name: 'Monaco' },
  { code: 'MN', name: 'Mongolia' }, { code: 'ME', name: 'Montenegro' }, { code: 'MA', name: 'Morocco' },
  { code: 'MZ', name: 'Mozambique' }, { code: 'MM', name: 'Myanmar' }, { code: 'NA', name: 'Namibia' },
  { code: 'NR', name: 'Nauru' }, { code: 'NP', name: 'Nepal' }, { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' }, { code: 'NI', name: 'Nicaragua' }, { code: 'NE', name: 'Niger' },
  { code: 'NG', name: 'Nigeria' }, { code: 'KP', name: 'North Korea' }, { code: 'MK', name: 'North Macedonia' },
  { code: 'NO', name: 'Norway' }, { code: 'OM', name: 'Oman' }, { code: 'PK', name: 'Pakistan' },
  { code: 'PW', name: 'Palau' }, { code: 'PS', name: 'Palestine' }, { code: 'PA', name: 'Panama' },
  { code: 'PG', name: 'Papua New Guinea' }, { code: 'PY', name: 'Paraguay' }, { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' }, { code: 'PL', name: 'Poland' }, { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' }, { code: 'CG', name: 'Republic of the Congo' }, { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' }, { code: 'RW', name: 'Rwanda' }, { code: 'KN', name: 'Saint Kitts and Nevis' },
  { code: 'LC', name: 'Saint Lucia' }, { code: 'VC', name: 'Saint Vincent and the Grenadines' }, { code: 'WS', name: 'Samoa' },
  { code: 'SM', name: 'San Marino' }, { code: 'ST', name: 'Sao Tome and Principe' }, { code: 'SA', name: 'Saudi Arabia' },
  { code: 'SN', name: 'Senegal' }, { code: 'RS', name: 'Serbia' }, { code: 'SC', name: 'Seychelles' },
  { code: 'SL', name: 'Sierra Leone' }, { code: 'SG', name: 'Singapore' }, { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' }, { code: 'SB', name: 'Solomon Islands' }, { code: 'SO', name: 'Somalia' },
  { code: 'ZA', name: 'South Africa' }, { code: 'KR', name: 'South Korea' }, { code: 'SS', name: 'South Sudan' },
  { code: 'ES', name: 'Spain' }, { code: 'LK', name: 'Sri Lanka' }, { code: 'SD', name: 'Sudan' },
  { code: 'SR', name: 'Suriname' }, { code: 'SE', name: 'Sweden' }, { code: 'CH', name: 'Switzerland' },
  { code: 'SY', name: 'Syria' }, { code: 'TW', name: 'Taiwan' }, { code: 'TJ', name: 'Tajikistan' },
  { code: 'TZ', name: 'Tanzania' }, { code: 'TH', name: 'Thailand' }, { code: 'TL', name: 'Timor-Leste' },
  { code: 'TG', name: 'Togo' }, { code: 'TO', name: 'Tonga' }, { code: 'TT', name: 'Trinidad and Tobago' },
  { code: 'TN', name: 'Tunisia' }, { code: 'TR', name: 'Turkey' }, { code: 'TM', name: 'Turkmenistan' },
  { code: 'TV', name: 'Tuvalu' }, { code: 'UG', name: 'Uganda' }, { code: 'UA', name: 'Ukraine' },
  { code: 'AE', name: 'United Arab Emirates' }, { code: 'GB', name: 'United Kingdom' }, { code: 'US', name: 'United States' },
  { code: 'UY', name: 'Uruguay' }, { code: 'UZ', name: 'Uzbekistan' }, { code: 'VU', name: 'Vanuatu' },
  { code: 'VA', name: 'Vatican City' }, { code: 'VE', name: 'Venezuela' }, { code: 'VN', name: 'Vietnam' },
  { code: 'YE', name: 'Yemen' }, { code: 'ZM', name: 'Zambia' }, { code: 'ZW', name: 'Zimbabwe' },
].sort((a, b) => a.name.localeCompare(b.name));

const COUNTRIES_BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c.name]));

// Accepts either a real ISO code (new orders/addresses) or a historical
// full-name string (any order/address saved before this change — those
// rows are never rewritten, see server/order-api.mjs) and always returns a
// real, displayable country name. Never invents a name for something it
// doesn't recognize — falls back to whatever was actually stored.
export function getCountryName(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (trimmed.length === 2) {
    const match = COUNTRIES_BY_CODE.get(trimmed.toUpperCase());
    if (match) return match;
  }
  return trimmed;
}

// True only for a real, recognized 2-letter code — used to guard against
// defaulting a form to visitorCountry's 'OTHER' sentinel (or any other
// unrecognized value) as if it were a real selectable country.
export function isSupportedCountryCode(code) {
  return Boolean(code) && COUNTRIES_BY_CODE.has(String(code).toUpperCase());
}

// The reverse — used only for resolving a legacy full-name value (e.g. a
// saved address from before this change) into a code, so old data can still
// populate the new code-based <CountrySelect>. Returns null if it isn't a
// recognized name (the caller then falls back to treating the raw value as
// free text rather than guessing).
export function getCountryCode(name) {
  if (!name) return null;
  const trimmed = String(name).trim().toLowerCase();
  const match = COUNTRIES.find((c) => c.name.toLowerCase() === trimmed);
  return match ? match.code : null;
}

// ── Real shipping destinations ──
// Urban Phoenix currently ships ONLY to these countries — this is the
// single source of truth for that restriction, used by:
//   - CheckoutPage.jsx / AccountAddresses.jsx: their <CountrySelect> only
//     ever offers these options for a real shipping destination (a
//     customer's own PROFILE country in AuthPage.jsx/AccountProfile.jsx is
//     a different, unrestricted field — see the COUNTRIES comment above).
//   - server/order-api.mjs: rejects any submitted delivery address whose
//     country isn't in this list, so a customer can never place a real
//     order to a country the storefront doesn't actually serve, even by
//     forging the request directly (never trust the frontend for this).
//   - server/delivery.mjs: still resolves a real zone/rate for any of these
//     (Armenia free, US free at $150+) — its 'international' catch-all zone
//     is deliberately left in place (not deleted) as the pricing this same
//     list can grow into: adding a third country here is the only change
//     needed on the frontend/validation side, and it already has a real
//     rate waiting for it.
// Adding a new supported country later means adding one entry here.
export const SUPPORTED_SHIPPING_COUNTRIES = [
  { code: 'AM', name: 'Armenia' },
  { code: 'US', name: 'United States' },
];

const SHIPPING_CODES = new Set(SUPPORTED_SHIPPING_COUNTRIES.map((c) => c.code));

// Accepts either a real code or (for backward compatibility with any
// already-submitted request) a historical full-name string.
export function isSupportedShippingCountry(value) {
  if (!value) return false;
  const trimmed = String(value).trim();
  if (trimmed.length === 2) return SHIPPING_CODES.has(trimmed.toUpperCase());
  return SUPPORTED_SHIPPING_COUNTRIES.some((c) => c.name.toLowerCase() === trimmed.toLowerCase());
}
