// Regression: the account Preferences toggle switches' knob (<span>) was
// position: absolute with only `top-0.5` set — no `left` — so its
// horizontal base position relied on the browser's default "static
// position" fallback instead of an explicit anchor. In the "on" state that
// resolved to left: 48px on a 48px-wide track, rendering the knob
// completely outside the pill instead of sliding inside it. Fixed in
// src/components/account/AccountPreferences.jsx by adding an explicit
// `left-0.5` base and simplifying the "on" offset to translate from it.
import { test, expect } from '@playwright/test';
import { dismissEntryPopups } from '../utils/popups.js';
import { registerAndVerifyCustomer, setCustomerSession } from '../utils/auth.js';

test('the preferences toggle knob stays inside its track in both states', async ({ page, request, baseURL }) => {
  const session = await registerAndVerifyCustomer(request, baseURL);

  await page.goto('/', { waitUntil: 'networkidle' });
  await dismissEntryPopups(page);
  await setCustomerSession(page, session);
  await page.goto('/account#preferences', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);

  const measure = () => page.evaluate(() => {
    const btn = document.querySelector('button[aria-pressed]');
    const dot = btn.querySelector('span');
    const btnRect = btn.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    return {
      pressed: btn.getAttribute('aria-pressed') === 'true',
      insideTrack: dotRect.left >= btnRect.left && dotRect.right <= btnRect.right,
    };
  });

  const before = await measure();
  expect(before.insideTrack, `knob should be inside its track in the initial (${before.pressed}) state`).toBe(true);

  await page.locator('button[aria-pressed]').first().click();
  await page.waitForTimeout(300);
  const after = await measure();
  expect(after.insideTrack, `knob should be inside its track after flipping to (${after.pressed})`).toBe(true);
  expect(after.pressed).not.toBe(before.pressed);
});
