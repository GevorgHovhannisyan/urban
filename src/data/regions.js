// Grouped country list for the region-select popup. Codes are ISO 3166-1
// alpha-2 and feed AppContext's visitorCountry (which drives currency and
// the US $150 free-shipping rule) — see AppContext.jsx's selectRegion.
//
// Urban Phoenix currently ships only to Armenia and the United States (the
// single source of truth is SUPPORTED_SHIPPING_COUNTRIES, src/data/countries.js)
// — this popup must never offer a country the store cannot actually ship to,
// since doing so falsely implies worldwide delivery before the visitor ever
// reaches checkout. Adding a new supported country later means adding it to
// SUPPORTED_SHIPPING_COUNTRIES and mirroring it here.
import { SUPPORTED_SHIPPING_COUNTRIES } from './countries';

export const REGION_GROUPS = [
  {
    group: 'We currently ship to',
    countries: SUPPORTED_SHIPPING_COUNTRIES,
  },
];
