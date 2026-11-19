// Dismisses the entry-flow popups that appear on a customer-facing page for
// a first-time visitor. New visitors get one combined dialog (RegionPopup.jsx:
// country + cookie choice); "Continue without selecting" saves both, so the
// standalone cookie popup (PrivacyPopup.jsx, for returning visitors who chose
// a country but never a cookie option) normally won't follow — the second
// step below is a no-op then. Reused across nearly every spec that lands on a
// customer-facing page, so this is genuine shared setup, not a speculative
// abstraction.
export async function dismissEntryPopups(page) {
  const skipRegion = page.locator('.region-popup__skip');
  // Both popups animate in on a short delay (region: 300ms, privacy: 450ms
  // — see RegionPopup.jsx/PrivacyPopup.jsx) — wait for the region popup to
  // actually appear (or confirm it's simply not showing, e.g. a returning
  // "visitor" whose localStorage already records a choice) before deciding
  // there's nothing to dismiss.
  await skipRegion.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
  if (await skipRegion.count()) {
    await skipRegion.click().catch(() => {});
  }

  const acceptPrivacy = page.locator('.privacy-popup-overlay button', { hasText: /accept|got it|ok/i }).first();
  await acceptPrivacy.waitFor({ state: 'visible', timeout: 1500 }).catch(() => {});
  if (await acceptPrivacy.count()) await acceptPrivacy.click().catch(() => {});
}
