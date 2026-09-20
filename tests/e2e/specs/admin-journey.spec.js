// Logs into the admin panel, creates a product, and confirms it's visible
// both in the admin list and on the live public storefront API.
import { test, expect } from '@playwright/test';
import { loginAsAdminViaUI } from '../utils/auth.js';

test('admin can log in, create a product, and see it live on the storefront', async ({ page, request, baseURL }) => {
  const consoleErrors = [];
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const testProductName = `QA E2E Product ${Date.now()}`;

  await test.step('admin login', async () => {
    await loginAsAdminViaUI(page, baseURL);
    await expect(page.locator('text=/dashboard/i').first()).toBeVisible({ timeout: 10000 });
  });

  await test.step('create a product', async () => {
    await page.goto('/admin/products', { waitUntil: 'networkidle' });
    const addProductBtn = page.getByRole('button', { name: /add product|new product|create product/i }).first();
    await addProductBtn.waitFor({ state: 'visible', timeout: 10000 });
    await addProductBtn.click();
    await page.waitForTimeout(300);

    await page.getByLabel('Name', { exact: true }).first().fill(testProductName);
    const priceInput = page.getByLabel('Price (USD)', { exact: true }).first();
    if (await priceInput.count()) await priceInput.fill('49.99');
    await page.getByRole('button', { name: /save|create/i }).last().click();
    await page.waitForTimeout(800);
  });

  await expect(page.locator(`text=${testProductName}`).first()).toBeVisible({ timeout: 5000 });

  const apiBody = await request.get(`${baseURL}/api/products`).then((r) => r.json());
  expect(apiBody.products.some((p) => p.name === testProductName)).toBe(true);

  expect(consoleErrors, `unexpected console errors: ${JSON.stringify(consoleErrors)}`).toHaveLength(0);
});
