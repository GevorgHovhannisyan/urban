// Verifies the checkout UI for the "FREE STANDARD SHIPPING ON U.S. ORDERS
// OVER $150" rule: the Shipping field must literally show "10,000 AMD" (not
// a currency-converted approximation) when charged, "FREE" when not, and
// must update immediately as the cart subtotal crosses the $150 threshold —
// without a page reload. The exact $149.99/$150.00/$150.01 boundary math
// itself is covered precisely at the API layer (tests/api/shipping-rule.test.mjs,
// items 1-4); this only proves the UI reflects that correctly and reactively.
//
// Increments quantity one click at a time and polls the Shipping field
// rather than pre-computing an exact click count from the catalog price —
// the live cart total already accounts for the US 1.15x regional multiplier
// (see AppContext.jsx's getRegionalPrice) in a way this test doesn't need to
// duplicate; it only needs to prove the field reacts correctly whenever the
// real threshold is actually crossed, which is a more faithful test of "live
// reactivity" than assuming a specific price anyway.
import { test, expect } from '@playwright/test';
import { dismissEntryPopups } from '../utils/popups.js';

test('checkout Shipping field shows "10,000 AMD" below the threshold and "FREE" above it, updating live as the cart changes', async ({ page, request, baseURL }) => {
  test.setTimeout(60000);
  const catalog = await request.get(`${baseURL}/api/products`).then((r) => r.json());
  // The cheapest purchasable product, so quantity 1 is comfortably under $150.
  const product = catalog.products
    .filter((p) => !p.isSoldOut && p.sizes?.length && p.colors?.length)
    .sort((a, b) => a.price - b.price)[0];
  expect(product, 'expected at least one purchasable product in the seeded catalog').toBeTruthy();

  // Seeded via addInitScript (runs before any app JS, on every navigation in
  // this context) rather than page.evaluate() after goto() — AppContext's
  // real ipapi.co-based visitor-country auto-detect effect races a
  // post-navigation evaluate() and can win, silently overwriting an
  // injected 'US' with its own fallback guess ('OTHER') before the test
  // ever gets to interact with the page. addInitScript eliminates the race
  // entirely by guaranteeing localStorage is already set before React mounts.
  await page.addInitScript(({ prod }) => {
    localStorage.setItem('up_visitor_country_v2', JSON.stringify({ code: 'US', ts: Date.now() }));
    localStorage.setItem('up_region_chosen', '1');
    localStorage.setItem('up_privacy_choice', JSON.stringify({ choice: 'all', savedAt: new Date().toISOString() }));
    localStorage.setItem('up_cart', JSON.stringify([{
      product: prod, size: prod.sizes[0], color: prod.colors[0], quantity: 1,
    }]));
  }, { prod: product });

  await page.goto('/checkout', { waitUntil: 'domcontentloaded' });
  await dismissEntryPopups(page);
  await page.waitForTimeout(500);

  // The shipping fee waiver checks the checkout address form's own country
  // field (defaults to "Armenia", which is unconditionally free-shipping),
  // independent of the visitor-geolocation flag set above — a real US
  // customer selects their country here, so the test does too.
  await page.locator('select[name="country"]').selectOption({ label: 'United States' });
  await page.waitForTimeout(300);

  const shippingRow = page.locator('div', { hasText: /^Shipping/ }).last();
  await expect(shippingRow).toContainText('10,000 AMD', { timeout: 5000 });

  const increaseBtn = page.getByRole('button', { name: /increase .* quantity/i }).first();
  let crossedToFree = false;
  for (let i = 0; i < 15; i += 1) {
    await increaseBtn.click();
    await page.waitForTimeout(150);
    const text = await shippingRow.innerText();
    if (text.includes('FREE')) { crossedToFree = true; break; }
  }
  expect(crossedToFree, 'increasing quantity enough should eventually cross the $150 threshold and switch the Shipping field to FREE, without a page reload').toBe(true);
  await expect(shippingRow).not.toContainText('10,000 AMD');

  // Bring it back down below the threshold and confirm shipping returns —
  // same live-reactivity check in the opposite direction.
  const decreaseBtn = page.getByRole('button', { name: /decrease .* quantity/i }).first();
  let crossedBackToCharged = false;
  for (let i = 0; i < 15; i += 1) {
    await decreaseBtn.click();
    await page.waitForTimeout(150);
    const text = await shippingRow.innerText();
    if (text.includes('10,000 AMD')) { crossedBackToCharged = true; break; }
  }
  expect(crossedBackToCharged, 'decreasing quantity back below the threshold should bring the 10,000 AMD shipping charge back').toBe(true);
});
