// Sets up authenticated sessions through the app's real HTTP endpoints —
// never by reaching into the database directly. This also sidesteps a real
// isolation problem the old scripts had: they imported server/db.mjs
// directly, which only works when the test process and the server process
// share the same DB_PATH. Under Playwright's webServer, the server runs in
// a separate process with its own randomly-generated temp database, so a
// spec process can't see it directly — going through the API (as a real
// user/client would) works regardless, and is arguably more honest E2E
// coverage besides.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@urbanphoenix.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

// Registers + verifies a brand-new customer via the real API and returns
// their session token, ready to drop into localStorage['up_user']. SMTP is
// never configured for e2e runs, so registerCustomer() returns
// `devVerificationCode` directly in the response instead of emailing it —
// this is the app's own documented "still testable end-to-end without an
// email provider" escape hatch (server/customer-auth.mjs), not a test-only
// backdoor.
export async function registerAndVerifyCustomer(request, baseURL, overrides = {}) {
  const email = overrides.email || `qa-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const firstName = overrides.firstName || 'QA';
  const lastName = overrides.lastName || 'E2E';

  const registerRes = await request.post(`${baseURL}/api/auth/register`, {
    data: { firstName, lastName, email, password: 'TestPass123', country: overrides.country || 'Armenia' },
  });
  const registerBody = await registerRes.json();
  if (!registerRes.ok()) throw new Error(`registerAndVerifyCustomer: registration failed: ${JSON.stringify(registerBody)}`);

  const verifyRes = await request.post(`${baseURL}/api/auth/verify-code`, {
    data: { email, code: registerBody.devVerificationCode },
  });
  const verifyBody = await verifyRes.json();
  if (!verifyRes.ok()) throw new Error(`registerAndVerifyCustomer: verification failed: ${JSON.stringify(verifyBody)}`);

  return { token: verifyBody.token, user: verifyBody.user, email };
}

// Puts a customer session into localStorage the same way AppContext.jsx
// reads it on load, without going through the actual login form — used
// where the login UI itself isn't what's under test.
export async function setCustomerSession(page, { token, user }) {
  await page.evaluate(({ tok, u }) => {
    localStorage.setItem('up_user', JSON.stringify({ ...u, sessionToken: tok }));
  }, { tok: token, u: user });
}

// Drives the real admin login form — used by specs that are specifically
// about the admin UI (not just "need an authenticated admin session").
export async function loginAsAdminViaUI(page, baseURL) {
  await page.goto(`${baseURL}/admin`, { waitUntil: 'networkidle' });
  await page.locator('input[type="email"], input[name="email"]').first().fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').first().fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /log in|sign in/i }).first().click();
  await page.waitForTimeout(1000);
}

export { ADMIN_EMAIL, ADMIN_PASSWORD };
