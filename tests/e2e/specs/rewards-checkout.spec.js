// UP Society rewards, end to end in a real browser on desktop and mobile:
// earn points on a paid order → see the balance in the account → redeem
// them at checkout → the discount, remaining balance and order total update
// → the order is placed and the database balance reflects the redemption.
import { test, expect, devices } from '@playwright/test';
import { registerAndVerifyCustomer, setCustomerSession } from '../utils/auth.js';
import { dismissEntryPopups } from '../utils/popups.js';

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@urbanphoenix.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const ADDRESS = { firstName: 'QA', lastName: 'Rewards', phone: '+37400000000', country: 'Armenia', city: 'Yerevan', postalCode: '0001', address: '1 Test Street' };
const { defaultBrowserType, ...iPhone } = devices['iPhone 13'];

const VIEWPORTS = [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['mobile', iPhone],
];

for (const [label, device] of VIEWPORTS) {
  test.describe(`rewards on ${label}`, () => {
    test.use(device);

    test('earn points on a paid order, then redeem them at checkout', async ({ page, request, baseURL }) => {
      test.setTimeout(90000);
      const { token, user, email } = await registerAndVerifyCustomer(request, baseURL);
      const auth = { Authorization: `Bearer ${token}` };
      const overview = () => request.get(`${baseURL}/api/account/overview`, { headers: auth }).then((r) => r.json());

      // A purchasable variant (stock-tracked products can be sold out per size).
      // Seeded catalog products are placeholders (no price/sizes yet), so
      // this test creates its own real $120 hoodie through the admin API.
      const adminToken = await request.post(`${baseURL}/api/admin/login`, { data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })
        .then((r) => r.json()).then((b) => b.token);
      const adminAuth = { Authorization: `Bearer ${adminToken}` };
      const productId = `e2e-rewards-${label}-${Date.now()}`;
      const created = await request.post(`${baseURL}/api/admin/products`, {
        headers: adminAuth,
        data: { id: productId, name: `Rewards Test Hoodie ${label}`, price: 120, category: 'hoodies', colors: ['Black'], sizes: ['M'], stock: { 'M|Black': 50 } },
      });
      expect(created.ok(), await created.text()).toBeTruthy();
      let earned;
      let lastError = 'no candidate products';
      for (const product of [{ id: productId, sizes: ['M'], colors: ['Black'] }]) {
        for (const size of product.sizes) {
          const res = await request.post(`${baseURL}/api/orders`, {
            headers: auth,
            data: {
              customer: { ...ADDRESS, email },
              items: [{ productId: product.id, size, color: product.colors[0], quantity: 2 }],
              paymentMethod: 'cash_on_delivery',
              idempotencyKey: `e2e-rewards-${Date.now()}-${Math.random()}`,
            },
          });
          if (res.status() === 201) { earned = { product, size, order: await res.json() }; break; }
          lastError = `${res.status()} ${await res.text()}`;
        }
        if (earned) break;
      }
      expect(earned, `expected to place a seed order: ${lastError}`).toBeTruthy();

      await test.step('unpaid order: no points yet, shown as pending', async () => {
        const o = await overview();
        expect(o.loyaltyPoints).toBe(0);
        expect(o.pendingPoints).toBe(Math.floor(earned.order.subtotal));
      });

      await test.step('admin marks it paid → points are credited', async () => {
        const list = await request.get(`${baseURL}/api/admin/orders`, { headers: adminAuth }).then((r) => r.json());
        const orders = Array.isArray(list) ? list : list.orders;
        const row = orders.find((o) => o.orderNumber === earned.order.orderNumber);
        const res = await request.patch(`${baseURL}/api/admin/orders/${row.id}`, { headers: adminAuth, data: { paymentStatus: 'paid' } });
        expect(res.ok()).toBeTruthy();
        const o = await overview();
        expect(o.loyaltyPoints).toBe(Math.floor(earned.order.subtotal));
        expect(o.pendingPoints).toBe(0);
      });

      const pointsBefore = (await overview()).loyaltyPoints;
      const redeemable = Math.floor(pointsBefore / 100) * 100;
      expect(redeemable, 'the seed order should earn at least 100 points').toBeGreaterThanOrEqual(100);

      await page.goto('/', { waitUntil: 'networkidle' });
      await setCustomerSession(page, { token, user });
      await dismissEntryPopups(page);

      await test.step('account shows the correct balance', async () => {
        await page.goto('/account#rewards', { waitUntil: 'networkidle' });
        await dismissEntryPopups(page);
        await expect(page.getByText(pointsBefore.toLocaleString('en-US'), { exact: true }).first()).toBeVisible();
      });

      await test.step('add one item and open checkout', async () => {
        await page.goto(`/product/${earned.product.id}`, { waitUntil: 'networkidle' });
        await dismissEntryPopups(page);
        await page.locator('button:not([disabled])', { hasText: new RegExp(`^${earned.size}$`) }).first().click();
        await page.getByRole('button', { name: /add to bag|add to cart/i }).first().click();
        await page.waitForTimeout(300);
        await page.goto('/checkout', { waitUntil: 'networkidle' });
        await dismissEntryPopups(page);
      });

      const panel = page.getByTestId('checkout-rewards');
      const totalRow = page.locator('div.text-xl', { hasText: /^Total/ }).last();
      const totalValue = async () => Number((await totalRow.innerText()).replace(/[^\d.]/g, ''));

      await test.step('checkout shows balance and offer; redeeming applies the discount', async () => {
        await panel.scrollIntoViewIfNeeded();
        await expect(panel).toContainText(`${pointsBefore.toLocaleString('en-US')} points available`);
        await expect(panel).toContainText(`Redeem ${redeemable.toLocaleString('en-US')} points for`);
        await expect(panel).toContainText(/You'll earn \d+ points with this order/);
        const before = await totalValue();

        await page.getByTestId('use-points').check();
        await expect(panel).toContainText(`${(pointsBefore - redeemable).toLocaleString('en-US')} points remaining after this order`);
        await expect(page.getByText(`Rewards points (${redeemable.toLocaleString('en-US')})`)).toBeVisible();
        await expect.poll(totalValue).toBeLessThan(before);
        await panel.screenshot({ path: `test-results/rewards-panel-${label}.png` });

        await page.getByTestId('use-points').uncheck();
        await expect.poll(totalValue).toBe(before);
        await page.getByTestId('use-points').check();
      });

      await test.step('place the order (cash on delivery) and verify the database balance', async () => {
        const fill = async (name, value) => {
          const el = page.getByLabel(new RegExp(`^${name}$`, 'i')).first();
          if (await el.count() && await el.isEditable()) await el.fill(value); // logged-in email is locked
        };
        await fill('First name', ADDRESS.firstName);
        await fill('Last name', ADDRESS.lastName);
        await fill('Email', email);
        await fill('Phone', ADDRESS.phone);
        const city = page.getByRole('combobox', { name: /city/i }).first();
        await city.fill('Yerevan');
        await page.getByRole('option', { name: /^Yerevan$/ }).first().click();
        await page.getByRole('textbox', { name: /street address/i }).first().fill(ADDRESS.address);
        await page.getByText('Cash on Delivery', { exact: true }).first().click();
        await page.getByRole('button', { name: /place order|complete order/i }).first().click();
        await expect(page.getByRole('heading', { name: /thank you/i })).toBeVisible({ timeout: 15000 });
        await expect(page.locator('body')).toContainText(/has been created successfully/);
        await page.screenshot({ path: `test-results/rewards-confirmation-${label}.png`, fullPage: true });

        const o = await overview();
        expect(o.loyaltyPoints, 'redeemed points are deducted immediately').toBe(pointsBefore - redeemable);
        expect(o.pendingPoints, 'the new (unpaid) order earns on what was actually spent').toBeGreaterThan(0);
      });
    });
  });
}
