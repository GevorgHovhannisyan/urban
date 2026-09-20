// Real, production Collection 001 catalog — the actual 3 products Urban
// Phoenix currently sells. This is what server/seed.mjs backfills into the
// database on every boot (INSERT IGNORE — never overwrites a row that
// already exists, including one an admin has since edited).
//
// Deliberately sparse on anything not yet confirmed: price/colors/sizes/
// stock/images are placeholders (0 / [] / {}) rather than invented data —
// an admin fills these in via the Admin > Products panel (which already
// supports editing every one of these fields; no code change needed) once
// they're real. `materials` is the one real spec given for all three
// pieces; every other copy field (description/care/shipping/returns) is
// left blank for the same "don't invent it" reason.
const SHARED_MATERIALS = '80% cotton / 20% polyester, 450gsm, 3-thread fleece construction.';

export const COLLECTION_001_PRODUCTS = [
  {
    id: 'freedom-to-become',
    name: 'Freedom To Become',
    garmentType: 'hoodie',
    subtitle: 'Collection 001',
    price: 0,
    compareAtPrice: null,
    collection: 'Collection 001',
    category: 'hoodies',
    colors: [],
    sizes: [],
    images: [],
    stock: {},
    description: '',
    materials: SHARED_MATERIALS,
    care: '',
    shipping: '',
    returns: '',
    isNew: false,
    isFeatured: false,
    isLimitedEdition: false,
  },
  {
    id: 'built-different-made-to-become',
    name: 'Built Different. Made To Become.',
    garmentType: 'hoodie',
    subtitle: 'Collection 001',
    price: 0,
    compareAtPrice: null,
    collection: 'Collection 001',
    category: 'hoodies',
    colors: [],
    sizes: [],
    images: [],
    stock: {},
    description: '',
    materials: SHARED_MATERIALS,
    care: '',
    shipping: '',
    returns: '',
    isNew: false,
    isFeatured: false,
    isLimitedEdition: false,
  },
  {
    id: 'streets-shape-us-choice-defines-who-we-become',
    name: 'The Streets Shape Us. Choice Defines Who We Become.',
    garmentType: 'hoodie',
    subtitle: 'Collection 001',
    price: 0,
    compareAtPrice: null,
    collection: 'Collection 001',
    category: 'hoodies',
    colors: [],
    sizes: [],
    images: [],
    stock: {},
    description: '',
    materials: SHARED_MATERIALS,
    care: '',
    shipping: '',
    returns: '',
    isNew: false,
    isFeatured: false,
    isLimitedEdition: false,
  },
];
