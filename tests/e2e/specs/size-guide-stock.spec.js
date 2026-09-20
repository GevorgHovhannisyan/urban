// Regression: the Size Guide drawer used to compute "available" sizes
// purely from product.sizes (the list of sizes the product is ever offered
// in), never consulting per-variant stock — so a sold-out size/color could
// still show as selectable in the guide even though the real add-to-bag
// control on the page correctly disabled it. Fixed by passing selectedColor
// + variantStock into SizeGuideDrawer (src/pages/ProductPage.jsx,
// src/components/SizeGuideDrawer.jsx). Uses p001, which is stock-tracked in
// this catalog — skips gracefully if that ever changes rather than failing
// on an inapplicable scenario.
import { test, expect } from '@playwright/test';
import { dismissEntryPopups } from '../utils/popups.js';

test('size guide marks a sold-out size/color as sold out, matching the real add-to-bag control', async ({ page, request, baseURL }) => {
  const product = await request.get(`${baseURL}/api/products/p001`).then((r) => r.json()).then((b) => b.product);
  test.skip(!product.stockTracked, 'p001 is not stock-tracked in this environment; regression scenario not applicable.');

  await page.goto('/product/p001', { waitUntil: 'networkidle' });
  await dismissEntryPopups(page);

  const sizeButtons = await page.locator('button', { hasText: /^(XS|S|M|L|XL|XXL)$/ }).all();
  let soldOutSize = null;
  for (const btn of sizeButtons) {
    if (await btn.isDisabled()) { soldOutSize = (await btn.textContent()).trim(); break; }
  }
  test.skip(!soldOutSize, 'no sold-out size/color found on p001 for the active color; regression scenario not applicable right now.');

  await page.getByText('Size Guide', { exact: true }).first().click();
  await page.waitForTimeout(300);
  const guideBtn = page.locator('.size-guide-size-list button', { hasText: new RegExp(`^${soldOutSize}$`) }).first();
  await expect(guideBtn).toHaveClass(/is-sold-out/);
});
