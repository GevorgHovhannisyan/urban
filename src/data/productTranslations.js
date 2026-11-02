// Armenian/Russian product copy.
//
// Each product can carry its own translations, entered in Admin → Products
// (product.translations = { hy: { description, materials, care, shipping,
// returns }, ru: {...} }). When a field has none, the built-in translations
// below are used for product copy that is shared across the catalogue — so
// the current hoodies read in Armenian/Russian without any admin step — and
// only after that does a field fall back to the English text.
import { DELIVERY_ESTIMATES, FREE_US_SHIPPING_THRESHOLD } from './shippingRules.js';
import { RETURN_WINDOW_DAYS } from './returnPolicy.js';

// Shipping & returns are no longer per-product text: the product page shows
// the store-wide rules below (same source as checkout and the policies), so
// they are always correct and always translated.
export const PRODUCT_TEXT_FIELDS = ['description', 'materials', 'care'];

export function standardShippingText(language) {
  const { yerevan, armeniaRegions, unitedStates, russia } = DELIVERY_ESTIMATES;
  const threshold = FREE_US_SHIPPING_THRESHOLD;
  if (language === 'hy') {
    return `Երևան՝ ${yerevan} աշխատանքային օր, անվճար, առաքում մինչև դուռ։ Հայաստանի այլ մարզեր՝ ${armeniaRegions} աշխատանքային օր, անվճար, Հայփոստի միջոցով՝ մինչև ձեր փոստային բաժանմունքը։ ԱՄՆ՝ ${unitedStates} աշխատանքային օր, առաքում մինչև դուռ՝ ONEX-ի միջոցով։ Ռուսաստան՝ ${russia} աշխատանքային օր, մինչև մոտակա CDEK մասնաճյուղը։ ԱՄՆ և Ռուսաստան՝ անվճար $${threshold}-ից սկսած պատվերների դեպքում։`;
  }
  if (language === 'ru') {
    return `Ереван: ${yerevan} рабочих дня, бесплатно, доставка до двери. Другие регионы Армении: ${armeniaRegions} рабочих дней, бесплатно, Айпост (HayPost) — в ваше почтовое отделение. США: ${unitedStates} рабочих дней, доставка до двери (ONEX). Россия: ${russia} рабочих дней, в ближайший пункт СДЭК. США и Россия — бесплатно для заказов от $${threshold}.`;
  }
  return `Yerevan: ${yerevan} business days, free, door to door. Other regions of Armenia: ${armeniaRegions} business days, free, by HayPost to your local post office. United States: ${unitedStates} business days, door to door by ONEX. Russia: ${russia} business days, to your nearest CDEK branch. United States and Russia: free on orders of $${threshold}+.`;
}

export function standardReturnsText(language) {
  if (language === 'hy') return `Վերադարձն ընդունվում է ստանալուց հետո ${RETURN_WINDOW_DAYS} օրվա ընթացքում՝ համաձայն մեր վերադարձի քաղաքականության։ Ապրանքները պետք է կրված չլինեն և ունենան բնօրինակ պիտակները։`;
  if (language === 'ru') return `Возврат принимается в течение ${RETURN_WINDOW_DAYS} дней после получения в соответствии с нашей политикой возврата. Товар должен быть неношеным, с оригинальными бирками.`;
  return `Returns accepted within ${RETURN_WINDOW_DAYS} days of delivery, subject to our return policy. Items must be unworn with original tags attached.`;
}

// Keys are the English text exactly as entered in the admin (compared after
// collapsing whitespace, normalising "15-20" to "15–20" and ignoring case).
const BUILT_IN = {
  'heavy': {
    hy: 'Ծանր, խիտ կտոր։',
    ru: 'Плотная, тяжёлая ткань.',
  },
  'Heavyweight oversized hoodie. Built for comfort, designed to represent individuality and strength.': {
    hy: 'Խիտ կտորից, ազատ ձևվածքով հուդի։ Ստեղծված է հարմարավետության համար և նախագծված՝ արտահայտելու անհատականությունն ու ուժը։',
    ru: 'Плотное худи свободного кроя. Создано для комфорта и воплощает индивидуальность и силу.',
  },
  '80% Cotton / 20% Polyester, 450 GSM, 3-Thread Fleece': {
    hy: '80% բամբակ / 20% պոլիէսթեր, 450 գ/մ², եռաթել ֆլիս',
    ru: '80% хлопок / 20% полиэстер, 450 г/м², трёхнитка с начёсом',
  },
  '80% cotton / 20% polyester, 450gsm, 3-thread fleece construction.': {
    hy: '80% բամբակ / 20% պոլիէսթեր, 450 գ/մ², եռաթել ֆլիսե կառուցվածք։',
    ru: '80% хлопок / 20% полиэстер, 450 г/м², трёхнитка с начёсом.',
  },
  'Machine wash cold (30°C). Wash inside out. Do not bleach. Do not tumble dry. Do not iron directly on print.': {
    hy: 'Մեքենայական լվացում սառը ջրով (30°C)։ Լվանալ շրջված վիճակում։ Չսպիտակեցնել։ Չչորացնել չորանոցում։ Չարդուկել անմիջապես տպագրի վրա։',
    ru: 'Машинная стирка в холодной воде (30°C). Стирать наизнанку. Не отбеливать. Не сушить в барабане. Не гладить по принту.',
  },
  'Yerevan: 4–7 business days. Armenian regions: 7–10 business days. International: 15–20 business days.': {
    hy: 'Երևան՝ 4–7 աշխատանքային օր։ Հայաստանի մարզեր՝ 7–10 աշխատանքային օր։ Միջազգային առաքում՝ 15–20 աշխատանքային օր։',
    ru: 'Ереван: 4–7 рабочих дней. Регионы Армении: 7–10 рабочих дней. Международная доставка: 15–20 рабочих дней.',
  },
  'Yerevan: 3–4 business days. Armenian regions: 7–10 business days. International: 15–20 business days.': {
    hy: 'Երևան՝ 3–4 աշխատանքային օր։ Հայաստանի մարզեր՝ 7–10 աշխատանքային օր։ Միջազգային առաքում՝ 15–20 աշխատանքային օր։',
    ru: 'Ереван: 3–4 рабочих дня. Регионы Армении: 7–10 рабочих дней. Международная доставка: 15–20 рабочих дней.',
  },
  'Yerevan: 3–4 business days. Other regions of Armenia: 7–10 business days. International: 15–20 business days.': {
    hy: 'Երևան՝ 3–4 աշխատանքային օր։ Հայաստանի այլ մարզեր՝ 7–10 աշխատանքային օր։ Միջազգային առաքում՝ 15–20 աշխատանքային օր։',
    ru: 'Ереван: 3–4 рабочих дня. Другие регионы Армении: 7–10 рабочих дней. Международная доставка: 15–20 рабочих дней.',
  },
  'Returns accepted within 15 days of delivery, subject to our return policy.': {
    hy: 'Վերադարձն ընդունվում է ստանալուց հետո 15 օրվա ընթացքում՝ համաձայն մեր վերադարձի քաղաքականության։',
    ru: 'Возврат принимается в течение 15 дней после получения в соответствии с нашей политикой возврата.',
  },
  'Returns accepted within 15 days of delivery, subject to our return policy. Items must be unworn with original tags attached.': {
    hy: 'Վերադարձն ընդունվում է ստանալուց հետո 15 օրվա ընթացքում՝ համաձայն մեր վերադարձի քաղաքականության։ Ապրանքները պետք է կրված չլինեն և ունենան բնօրինակ պիտակները։',
    ru: 'Возврат принимается в течение 15 дней после получения в соответствии с нашей политикой возврата. Товар должен быть неношеным, с оригинальными бирками.',
  },
};

const normalize = (text) => String(text || '').trim().replace(/\s+/g, ' ').replace(/(\d)\s*-\s*(\d)/g, '$1–$2').toLowerCase();
const BUILT_IN_INDEX = new Map(Object.entries(BUILT_IN).map(([english, value]) => [normalize(english), value]));

// The built-in translation for an English product text, or '' if none.
export function builtInProductTranslation(englishText, language) {
  return BUILT_IN_INDEX.get(normalize(englishText))?.[language] || '';
}

// What the storefront shows for one product field in `language`:
// admin translation → built-in translation → the English text.
export function localizeProductField(product, field, language) {
  const english = product?.[field] || '';
  if (!language || language === 'en') return english;
  return product?.translations?.[language]?.[field] || builtInProductTranslation(english, language) || english;
}
