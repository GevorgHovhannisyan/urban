// Regression: useDialogBehavior's setup effect depended on `onClose`, but
// nearly every caller passes an inline `() => setOpen(false)` — a new
// function reference on every parent render. Typing into any input inside
// one of these dialogs (admin product form, search overlay, etc.) triggers a
// parent re-render on every keystroke, which re-ran the effect and stole
// focus back to the dialog's first focusable element each time — so only
// the first character of anything typed ever landed. Fixed in
// src/hooks/useDialogBehavior.js by routing onClose through a ref instead of
// the effect's dependency array.
import { test, expect } from '@playwright/test';
import { dismissEntryPopups } from '../utils/popups.js';
import { loginAsAdminViaUI } from '../utils/auth.js';

test('typing into the admin product form Name field is not interrupted by focus-stealing', async ({ page, baseURL }) => {
  await loginAsAdminViaUI(page, baseURL);
  await page.goto('/admin/products', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /add product/i }).first().click();
  await page.waitForTimeout(300);

  const nameInput = page.getByLabel('Name', { exact: true }).first();
  await nameInput.click();
  await page.keyboard.type('edgetest', { delay: 40 });
  await expect(nameInput).toHaveValue('edgetest');
});

test('typing into the storefront search overlay is not interrupted by focus-stealing', async ({ page }) => {
  await page.goto('/', { waitUntil: 'networkidle' });
  await dismissEntryPopups(page);
  await page.locator('button[aria-label="Search"]').first().click();
  await page.waitForTimeout(300);

  const searchInput = page.locator('input[placeholder*="Search products" i]').first();
  await searchInput.click();
  await page.keyboard.type('jacket', { delay: 40 });
  await expect(searchInput).toHaveValue('jacket');
});
