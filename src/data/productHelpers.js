// Pure list-transformation helpers for the real product catalog. These take
// `list` as a required argument (no default) so there is no static/demo
// catalog to silently fall back to if a call site ever forgot to pass one —
// every caller must supply the real `products` array from AppContext.
export const getFeaturedProducts = (list) => list.filter(p => p.isFeatured);
export const getSaleProducts = (list) => list.filter(p => Number(p.compareAtPrice) > Number(p.price));
export const getRelatedProducts = (product, limit, list) => list.filter(p => p.id !== product.id && p.category === product.category).slice(0, limit);
