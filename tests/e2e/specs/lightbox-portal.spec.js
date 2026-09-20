// Regression: the product image lightbox in src/pages/ProductPage.jsx used
// `position: fixed` without being portaled to document.body. Since it
// renders inside App.jsx's `.page-transition` wrapper (whose fade animation
// leaves a lingering `transform` after it finishes, creating a new
// containing block for `position: fixed` descendants — a recurring bug
// class in this project), opening the lightbox after scrolling down the
// page positioned it relative to the full scrolled document instead of the
// viewport, so the zoomed image rendered off-screen instead of centered.
// Fixed by wrapping it in createPortal(..., document.body).
import { test, expect } from '@playwright/test';
import { dismissEntryPopups } from '../utils/popups.js';

test.use({ viewport: { width: 1440, height: 900 } });

test('the image lightbox stays centered in the viewport after scrolling down the page', async ({ page, request, baseURL }) => {
  const catalog = await request.get(`${baseURL}/api/products`).then((r) => r.json());
  const product = catalog.products.find((p) => (p.images || []).length > 0) || catalog.products[0];

  await page.goto(`/product/${product.id}`, { waitUntil: 'networkidle' });
  await dismissEntryPopups(page);

  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.waitForTimeout(200);
  await page.locator('.cursor-zoom-in').first().click();
  await page.waitForTimeout(300);

  const result = await page.evaluate(() => {
    const img = document.querySelector('[aria-label$="image"][role="dialog"] img');
    if (!img) return { found: false };
    const rect = img.getBoundingClientRect();
    return { found: true, visible: rect.bottom > 0 && rect.top < window.innerHeight };
  });

  expect(result.found, 'expected the lightbox image element to be found').toBe(true);
  expect(result.visible, 'expected the lightbox image to be positioned within the viewport, not off-screen relative to the scrolled document').toBe(true);
});
