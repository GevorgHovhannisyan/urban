// Regression: unrecognized routes and bad product ids used to render a
// blank page (just header/footer, no content, no error message) instead of
// a 404 — the router's conditional chain in src/App.jsx had no default/
// fallback case, and src/context/AppContext.jsx silently fell back to
// staticProducts[0] whenever a requested product id failed to match,
// showing the wrong product instead of an error.
import { test, expect } from '@playwright/test';

test('an unrecognized route shows a 404 page', async ({ page }) => {
  await page.goto('/this-route-does-not-exist', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText(/404|page not found/i);
});

test('an unknown product id shows a 404 page, not a fallback to some other product', async ({ page }) => {
  await page.goto('/product/this-product-id-does-not-exist', { waitUntil: 'networkidle' });
  await expect(page.locator('body')).toContainText(/404|page not found/i);
});

test('a valid product id still resolves normally (no over-correction from the 404 fix)', async ({ page, request, baseURL }) => {
  // Uses a fixed, known-seeded product id (p001) rather than
  // catalog.products[0] — that list is sorted newest-first and other specs
  // (e.g. admin-journey) create products concurrently under Playwright's
  // parallel workers, which made "the first product in the list" a race
  // condition rather than a stable fixture.
  const catalog = await request.get(`${baseURL}/api/products`).then((r) => r.json());
  const realProduct = catalog.products.find((p) => p.id === 'p001') || catalog.products[0];
  await page.goto(`/product/${realProduct.id}`, { waitUntil: 'networkidle' });
  const bodyText = await page.locator('body').innerText();
  expect(bodyText.toLowerCase()).toContain(realProduct.name.toLowerCase());
});
