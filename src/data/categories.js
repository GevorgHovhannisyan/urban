export const ALL_CATEGORIES = ['hoodies', 'tops', 'bottoms', 'outerwear', 'accessories'];
export const CATEGORY_LABELS = { hoodies: 'Hoodies', tops: 'T-Shirts', bottoms: 'Pants', outerwear: 'Outerwear', accessories: 'Accessories' };

// Categories currently open for sale — the single switch for the whole
// storefront (header menu, mobile menu, footer, Shop filters, and which
// products load at all). Add an id back here to reopen that category.
export const LIVE_CATEGORIES = ['hoodies'];
export const CATEGORIES = ALL_CATEGORIES.filter((id) => LIVE_CATEGORIES.includes(id));
