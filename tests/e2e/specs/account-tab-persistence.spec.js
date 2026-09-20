// Regression: the account page's active tab (Orders, Preferences, etc.) was
// plain local useState with no reflection in the URL at all, so refreshing
// while on any tab but Overview silently dropped back to Overview. Fixed in
// src/components/account/AccountLayout.jsx by syncing the section to a URL
// hash, mirroring the pattern src/admin/AdminApp.jsx already used for its
// own section routing.
import { test, expect } from '@playwright/test';
import { dismissEntryPopups } from '../utils/popups.js';
import { registerAndVerifyCustomer, setCustomerSession } from '../utils/auth.js';

test('the active account tab survives a page reload via the URL hash', async ({ page, request, baseURL }) => {
  const session = await registerAndVerifyCustomer(request, baseURL);

  await page.goto('/', { waitUntil: 'networkidle' });
  await dismissEntryPopups(page);
  await setCustomerSession(page, session);
  await page.goto('/account', { waitUntil: 'networkidle' });

  await page.locator('a, button').filter({ hasText: /preferences/i }).first().click();
  await page.waitForTimeout(300);
  await expect(page).toHaveURL(/#preferences$/);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await expect(page.locator('button[aria-pressed]').first()).toBeVisible({ timeout: 5000 });
});
