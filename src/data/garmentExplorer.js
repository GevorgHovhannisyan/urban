// Garment Explorer — global apparel feature.
//
// Resolution order for any product, cheapest/most-specific first:
//   1. product.garmentExplorer      — if the live `/api/products` catalog ever
//                                      starts returning this field directly
//                                      (future admin editing), it always wins.
//   2. garmentExplorerByProductId   — hand-authored per-product overrides kept
//                                      in this file (see `p002` below for a
//                                      worked example). Optional, not required.
//   3. Auto-generated default       — built from the product's own images,
//                                      category/garmentType, and materials
//                                      text. This is what makes the section
//                                      appear on every apparel product without
//                                      hardcoding each one.
//
// This is a plain, hand-authored/generated config rather than admin/backend-
// driven data because product records here are served from an external API
// (see AppContext's `/api/products` fetch) that this repo doesn't own the
// schema or persistence layer for. `product.garmentExplorer` is the seam
// that lets a future backend field slot in ahead of both of the above with
// zero frontend changes.

// Only "accessories" (caps, bags, etc.) are excluded — garment-construction
// hotspots don't make sense on them. Every other catalog category is real
// clothing. Gift cards aren't part of the `products` catalog at all, so they
// never reach this check.
const INELIGIBLE_CATEGORIES = new Set(['accessories']);

export function isApparelEligible(product) {
  if (!product) return false;
  if (INELIGIBLE_CATEGORIES.has(product.category)) return false;
  return Array.isArray(product.images) && product.images.filter(Boolean).length > 0;
}

// ---- Fact extraction ----
// Every one of these pulls a fact that is already literally present in the
// product's own `materials` string — never a value we made up. Phrasing that
// doesn't match one of these patterns is simply omitted rather than guessed
// at; an honest gap is better than an invented spec.
function extractGsm(text) {
  const m = /(\d{2,4})\s*gsm/i.exec(text || '');
  return m ? `${m[1]} GSM` : null;
}

const FIBER_NAMES = 'cotton|polyester|nylon|elastane|wool|linen|spandex|viscose|rayon|silk';
function extractFiberBlend(text) {
  if (!text) return null;
  const single = `\\d{1,3}%\\s*(?:[a-z]+\\s+)*?(?:${FIBER_NAMES})`;
  const re = new RegExp(`(${single})(?:\\s*\\/\\s*(${single}))?`, 'i');
  const m = re.exec(text);
  if (!m) return null;
  return [m[1], m[2]].filter(Boolean).join(' / ').replace(/\s+/g, ' ').trim();
}

const CONSTRUCTION_TERMS = [
  'french terry', 'loopback', 'ribbed', 'brushed interior', 'twill', 'canvas',
  'satin', 'quilted', 'mesh lining', 'combed cotton', 'garment washed',
  'pre-washed', 'washed finish', 'double-stitched', 'water-resistant',
  'technical fabric', 'performance fabric',
];
function titleCase(str) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase());
}
function extractConstructionTerms(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  return CONSTRUCTION_TERMS.filter((term) => lower.includes(term)).map(titleCase);
}
function fabricSpecs(materials) {
  const specs = [];
  const gsm = extractGsm(materials);
  if (gsm) specs.push(gsm);
  specs.push(...extractConstructionTerms(materials));
  return specs;
}
// For non-fabric hotspots (collar, cuff, hem…) — only surfaces a spec if one
// of the given exact phrases appears verbatim in the product's materials
// text. Phrasing that doesn't match (e.g. "ribbed collar, cuffs and hem" for
// a cuff hotspot looking for "ribbed cuff") is a false negative by design:
// omitting a real-but-unmatched fact is safe, inventing one is not.
function phraseSpecs(materials, phrases) {
  if (!materials) return [];
  const lower = materials.toLowerCase();
  return phrases.filter((p) => lower.includes(p.toLowerCase())).map(titleCase);
}

// ---- Default hotspot templates, by garment type ----
// x/y are percentage positions estimated for a typical front-facing garment
// photo — reasonable starting points, meant to be overridden per product
// (via garmentExplorerByProductId or product.garmentExplorer) once real
// annotated photography is available.
const TEMPLATES = {
  tshirt: [
    { id: 'fabric', view: 'front', x: 35, y: 45, label: 'Fabric', title: 'Fabric', kind: 'fabric',
      description: 'The base fabric weight and construction that defines how this piece drapes and wears over time.' },
    { id: 'collar', view: 'front', x: 50, y: 13, label: 'Collar', title: 'Collar',
      description: 'The collar finish that frames the neckline and holds its shape wear after wear.',
      specPhrases: ['ribbed collar'] },
    { id: 'sleeve', view: 'front', x: 80, y: 42, label: 'Sleeve', title: 'Sleeve',
      description: 'Sleeve cut and finish, built to move with the body without losing its line.',
      specPhrases: ['dropped shoulder'] },
    { id: 'front', view: 'front', x: 50, y: 55, label: 'Front', title: 'Front Panel',
      description: 'The front panel — where the garment’s silhouette and any front detailing read first.' },
    { id: 'hem', view: 'front', x: 50, y: 90, label: 'Hem', title: 'Hem',
      description: 'The hem finish anchors the fit, keeping the drape intentional rather than shapeless.',
      specPhrases: ['double-stitched hem', 'ribbed hem'] },
    { id: 'back-print', view: 'back', x: 50, y: 38, label: 'Back Print', title: 'Back Print',
      description: 'The back panel, sized to read clean whether worn alone or layered.' },
  ],
  longsleeve: [
    { id: 'fabric', view: 'front', x: 35, y: 45, label: 'Fabric', title: 'Fabric', kind: 'fabric',
      description: 'The base fabric weight and construction that defines how this piece drapes and wears over time.' },
    { id: 'collar', view: 'front', x: 50, y: 13, label: 'Collar', title: 'Collar',
      description: 'The collar finish that frames the neckline and holds its shape wear after wear.',
      specPhrases: ['ribbed collar'] },
    { id: 'cuff', view: 'front', x: 16, y: 78, label: 'Cuff', title: 'Cuff',
      description: 'Cuff construction designed to retain its shape at the wrist.',
      specPhrases: ['ribbed cuff', 'ribbed cuffs'] },
    { id: 'front', view: 'front', x: 50, y: 55, label: 'Front', title: 'Front Panel',
      description: 'The front panel — where the garment’s silhouette and any front detailing read first.' },
    { id: 'hem', view: 'front', x: 50, y: 90, label: 'Hem', title: 'Hem',
      description: 'The hem finish anchors the fit, keeping the drape intentional rather than shapeless.',
      specPhrases: ['double-stitched hem', 'ribbed hem'] },
    { id: 'back-print', view: 'back', x: 50, y: 38, label: 'Back Print', title: 'Back Print',
      description: 'The back panel, sized to read clean whether worn alone or layered.' },
  ],
  hoodie: [
    { id: 'fabric', view: 'front', x: 32, y: 46, label: 'Fabric', title: 'Fabric', kind: 'fabric',
      description: 'Heavyweight fabric engineered for a structured silhouette — dense enough to hold its shape, soft enough to move with you.' },
    { id: 'hood', view: 'front', x: 50, y: 11, label: 'Hood', title: 'Hood',
      description: 'A hood built for coverage and drape, cut to sit with weight rather than collapse flat against the neck.' },
    { id: 'chest', view: 'front', x: 50, y: 32, label: 'Chest', title: 'Chest / Embroidery',
      description: 'The chest panel — where a tonal mark or logo is placed to register without shouting for attention.' },
    { id: 'sleeve', view: 'front', x: 80, y: 45, label: 'Sleeve', title: 'Sleeve',
      description: 'Sleeve cut and finish, built to move with the body without losing its line.' },
    { id: 'cuff', view: 'front', x: 16, y: 62, label: 'Cuff', title: 'Cuff',
      description: 'Cuff construction designed to retain its shape and create a structured finish around the wrist.',
      specPhrases: ['ribbed cuff', 'ribbed cuffs'] },
    { id: 'hem', view: 'front', x: 50, y: 90, label: 'Hem', title: 'Hem / Ribbing',
      description: 'A ribbed hem anchors the fit, keeping the drape intentional rather than shapeless.',
      specPhrases: ['ribbed hem'] },
    { id: 'back-print', view: 'back', x: 50, y: 38, label: 'Back Print', title: 'Back Print',
      description: 'The back panel carries the piece’s signature statement, sized to read clean under outerwear or worn alone.' },
  ],
  sweatshirt: [
    { id: 'fabric', view: 'front', x: 32, y: 46, label: 'Fabric', title: 'Fabric', kind: 'fabric',
      description: 'The base fabric weight and construction that defines how this piece drapes and wears over time.' },
    { id: 'collar', view: 'front', x: 50, y: 13, label: 'Collar', title: 'Collar',
      description: 'The collar finish that frames the neckline and holds its shape wear after wear.',
      specPhrases: ['ribbed collar'] },
    { id: 'chest', view: 'front', x: 50, y: 33, label: 'Chest', title: 'Chest',
      description: 'The chest panel — where a tonal mark or logo is placed to register without shouting for attention.' },
    { id: 'sleeve', view: 'front', x: 80, y: 45, label: 'Sleeve', title: 'Sleeve',
      description: 'Sleeve cut and finish, built to move with the body without losing its line.' },
    { id: 'cuff', view: 'front', x: 16, y: 62, label: 'Cuff', title: 'Cuff',
      description: 'Cuff construction designed to retain its shape around the wrist.',
      specPhrases: ['ribbed cuff', 'ribbed cuffs'] },
    { id: 'hem', view: 'front', x: 50, y: 90, label: 'Hem', title: 'Hem',
      description: 'The hem finish anchors the fit, keeping the drape intentional rather than shapeless.',
      specPhrases: ['ribbed hem'] },
    { id: 'back', view: 'back', x: 50, y: 38, label: 'Back', title: 'Back',
      description: 'The back panel, sized to read clean whether worn alone or layered.' },
  ],
  outerwear: [
    { id: 'fabric', view: 'front', x: 32, y: 46, label: 'Fabric', title: 'Shell Fabric', kind: 'fabric',
      description: 'The shell fabric that defines this piece’s hand-feel, structure and weather behavior.' },
    { id: 'collar', view: 'front', x: 50, y: 12, label: 'Collar', title: 'Collar',
      description: 'The collar construction that frames the neckline and holds its shape.',
      specPhrases: ['ribbed collar'] },
    { id: 'sleeve', view: 'front', x: 80, y: 42, label: 'Sleeve', title: 'Sleeve',
      description: 'Sleeve cut and finish, built to move with the body without losing its line.' },
    { id: 'cuff', view: 'front', x: 16, y: 62, label: 'Cuff', title: 'Cuff',
      description: 'Cuff construction designed to seal the wrist and hold its shape.',
      specPhrases: ['ribbed cuff', 'ribbed cuffs'] },
    { id: 'pocket', view: 'front', x: 22, y: 55, label: 'Pocket', title: 'Pocket',
      description: 'Pocket placement built for function as much as silhouette.',
      specPhrases: ['chest pocket', 'side pockets', 'zip pockets'] },
    { id: 'hem', view: 'front', x: 50, y: 90, label: 'Hem', title: 'Hem',
      description: 'The hem finish anchors the fit and closes off the silhouette.',
      specPhrases: ['ribbed hem'] },
    { id: 'back', view: 'back', x: 50, y: 38, label: 'Back', title: 'Back',
      description: 'The back panel, sized to read clean whether worn alone or layered.' },
  ],
  bottoms: [
    { id: 'fabric', view: 'front', x: 35, y: 40, label: 'Fabric', title: 'Fabric', kind: 'fabric',
      description: 'The base fabric weight and construction that defines how this piece moves and wears over time.' },
    { id: 'waistband', view: 'front', x: 50, y: 14, label: 'Waistband', title: 'Waistband',
      description: 'The waistband construction that carries the fit at the top of the garment.',
      specPhrases: ['elasticated waistband', 'adjustable drawcord'] },
    { id: 'pocket', view: 'front', x: 22, y: 45, label: 'Pocket', title: 'Pocket',
      description: 'Pocket placement built for function as much as silhouette.',
      specPhrases: ['side zip pockets', 'zip pockets', 'six pockets'] },
    { id: 'leg', view: 'front', x: 65, y: 65, label: 'Leg', title: 'Leg',
      description: 'The leg cut that defines how this piece sits and moves below the waist.' },
    { id: 'hem', view: 'front', x: 50, y: 92, label: 'Hem', title: 'Hem',
      description: 'The hem finish that closes off the leg.',
      specPhrases: ['adjustable ankle tabs'] },
    { id: 'back', view: 'back', x: 50, y: 45, label: 'Back', title: 'Back',
      description: 'The back panel and construction, sized to read clean from behind.' },
  ],
  // Final fallback for any apparel product whose garmentType/category
  // doesn't match a more specific template above.
  default: [
    { id: 'fabric', view: 'front', x: 35, y: 45, label: 'Fabric', title: 'Fabric', kind: 'fabric',
      description: 'The base fabric weight and construction that defines how this piece drapes and wears over time.' },
    { id: 'construction', view: 'front', x: 65, y: 40, label: 'Construction', title: 'Construction',
      description: 'The build quality and seam work that hold this garment together over years of wear.' },
    { id: 'detail', view: 'front', x: 50, y: 32, label: 'Detail', title: 'Detail',
      description: 'A defining detail of this piece — the mark it leaves at a glance.' },
    { id: 'hem', view: 'front', x: 50, y: 90, label: 'Hem', title: 'Hem',
      description: 'The hem finish anchors the fit, keeping the drape intentional rather than shapeless.',
      specPhrases: ['ribbed hem', 'double-stitched hem'] },
    { id: 'back', view: 'back', x: 50, y: 38, label: 'Back', title: 'Back',
      description: 'The back panel, sized to read clean whether worn alone or layered.' },
  ],
};

function resolveTemplateKey(product) {
  const garmentType = String(product.garmentType || '').toLowerCase();
  if (TEMPLATES[garmentType]) return garmentType;
  switch (product.category) {
    case 'hoodies': return 'hoodie';
    case 'outerwear': return 'outerwear';
    case 'bottoms': return 'bottoms';
    case 'tops': return 'tshirt';
    default: return 'default';
  }
}

function toHotspot(blueprint, materials) {
  const isFabric = blueprint.kind === 'fabric';
  return {
    id: blueprint.id,
    view: blueprint.view,
    x: blueprint.x,
    y: blueprint.y,
    label: blueprint.label,
    title: blueprint.title,
    description: blueprint.description,
    material: isFabric ? (extractFiberBlend(materials) || '') : '',
    specs: isFabric ? fabricSpecs(materials) : phraseSpecs(materials, blueprint.specPhrases || []),
  };
}

// Builds a Garment Explorer config purely from data the product already
// has: its own images (never another product's) and its own `materials`
// text for specs. Returns null if there isn't enough to show (no images).
function buildDefaultExplorer(product) {
  const images = (product.images || []).filter(Boolean);
  if (images.length === 0) return null;
  const frontImage = images[0];
  const backImage = images.length > 1 && images[1] !== images[0] ? images[1] : null;

  const blueprint = TEMPLATES[resolveTemplateKey(product)] || TEMPLATES.default;
  const hotspots = blueprint
    .filter((h) => h.view === 'front' || Boolean(backImage))
    .map((h) => toHotspot(h, product.materials));
  if (hotspots.length === 0) return null;

  return { enabled: true, frontImage, backImage, hotspots };
}

// ---- Hand-authored per-product overrides ----
// Optional. A product with no entry here still gets a full auto-generated
// Garment Explorer via buildDefaultExplorer — this map is only for cases
// worth curating by hand (real annotated hotspot positions, richer copy).
export const garmentExplorerByProductId = {
  p002: {
    enabled: true,
    frontImage: 'https://images.unsplash.com/photo-1512436991641-6745cdb1723f?w=1400&h=1867&fit=crop&auto=format&q=80',
    backImage: 'https://images.unsplash.com/photo-1620799140408-edc6dcb6d633?w=1400&h=1867&fit=crop&auto=format&q=80',
    hotspots: [
      {
        id: 'fabric', view: 'front', x: 32, y: 46, label: 'Fabric', title: 'Fabric',
        description: 'Heavyweight French terry engineered for a structured, oversized silhouette — dense enough to hold its shape, soft enough to move with you.',
        material: '80% Cotton / 20% Polyester',
        specs: ['450 GSM', 'French terry construction', 'Brushed interior finish'],
      },
      {
        id: 'hood', view: 'front', x: 50, y: 12, label: 'Hood', title: 'Hood',
        description: 'A drawcord hood built for coverage and drape, cut to sit with weight rather than collapse flat against the neck.',
        material: '', specs: [],
      },
      {
        id: 'embroidery', view: 'front', x: 50, y: 33, label: 'Embroidery', title: 'Embroidery / Front Logo',
        description: 'A tonal front mark, placed to register at a distance without shouting for attention.',
        material: '', specs: [],
      },
      {
        id: 'cuff', view: 'front', x: 16, y: 62, label: 'Cuff', title: 'Cuff',
        description: 'Ribbed cuff construction designed to retain its shape and create a structured finish around the wrist.',
        material: '', specs: ['Ribbed cotton-blend construction'],
      },
      {
        id: 'hem', view: 'front', x: 50, y: 90, label: 'Hem', title: 'Hem / Ribbing',
        description: 'A ribbed hem anchors the oversized body, keeping the drape intentional rather than shapeless.',
        material: '', specs: ['Ribbed cotton-blend construction'],
      },
      {
        id: 'pocket', view: 'front', x: 50, y: 68, label: 'Pocket', title: 'Kangaroo Pocket',
        description: 'A single kangaroo pocket across the front, reinforced where hands rest most.',
        material: '', specs: [],
      },
      {
        id: 'back-print', view: 'back', x: 50, y: 38, label: 'Back Print', title: 'Back Print',
        description: 'The back panel carries the piece’s signature statement, sized to read clean under outerwear or worn alone.',
        material: '', specs: [],
      },
      {
        id: 'stitching', view: 'back', x: 78, y: 55, label: 'Stitching', title: 'Stitching / Construction',
        description: 'Seam placement follows the body rather than fighting it, keeping the oversized cut from reading as unfinished.',
        material: '', specs: [],
      },
    ],
  },
};

function isValidConfig(config) {
  return Boolean(config) && config.enabled !== false
    && typeof config.frontImage === 'string' && config.frontImage.length > 0
    && Array.isArray(config.hotspots) && config.hotspots.length > 0;
}

export function getGarmentExplorer(product) {
  if (!product) return null;

  if (isValidConfig(product.garmentExplorer)) return product.garmentExplorer;

  const override = garmentExplorerByProductId[product.id];
  if (isValidConfig(override)) return override;

  if (!isApparelEligible(product)) return null;
  const generated = buildDefaultExplorer(product);
  return isValidConfig(generated) ? generated : null;
}
