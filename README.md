# Urban Phoenix — Store + Admin Panel

React + Vite storefront with a real Node.js/Express backend: SQLite database,
REST API, and a password-protected admin panel for managing products, orders,
reviews and limited-edition numbers.

## What's included

- **Storefront** — the original React/Vite site (home, shop, product pages,
  cart, checkout, wishlist, search, account, policies, etc.)
- **Backend API** (`server.mjs` + `server/*.mjs`) — Express server backed by a
  SQLite database (`data/urbanphoenix.db`, created automatically)
- **Admin panel** at `/admin` — plain HTML/JS dashboard (no separate build
  step) for:
  - **Dashboard** — revenue, order count, pending orders, live products, published reviews
  - **Products** — create, edit, archive, delete; controls name, price,
    category, colors, sizes, images, description, and flags (new/featured/limited edition)
  - **Orders** — view every order and update its fulfillment/payment status
  - **Reviews** — publish, hide, or delete customer reviews
  - **Limited editions** — see which numbered pieces (1–100) have sold for
    each limited-edition product, and release a number back into stock

## Requirements

- Node.js **22.5 or newer** (the backend uses Node's built-in `node:sqlite`
  module, so no native/compiled dependency is required)

## First-time setup

```bash
npm install
cp .env.example .env
```

Open `.env` and set:

```
ADMIN_EMAIL=you@yourdomain.com
ADMIN_PASSWORD=a-strong-password
JWT_SECRET=some-long-random-string
```

This admin account is created automatically **the first time the server
starts**. If you change `ADMIN_EMAIL`/`ADMIN_PASSWORD` after that first run,
it won't retroactively update the existing account — see "Managing the admin
account" below.

## Running it

**Development (frontend only, fast reload):**
```bash
npm run dev
```
Open http://localhost:5173. This mode also proxies `/api/*` to the same
database, so cart/checkout/reviews/products work, but the admin panel is only
served by the full server below.

**Full app (storefront + API + admin panel), production-style:**
```bash
npm run build
npm start
```
Open http://localhost:4173 for the store and **http://localhost:4173/admin**
for the admin panel. `npm run serve` does both steps in one command.

## Database

Everything is stored in a single SQLite file at `data/urbanphoenix.db`
(created and migrated automatically on first launch). On that first launch,
the server also seeds the database from whatever was previously in
`src/data/products.js` and `data/*.json`, so none of the existing catalog or
order history is lost.

To back it up, just copy `data/urbanphoenix.db`. To reset everything, stop
the server and delete `data/urbanphoenix.db` (and the `-wal`/`-shm` files next
to it) — it will be recreated and reseeded on the next start.

## Managing the admin account

The simplest way to add or change an admin login is to stop the server,
delete the `data/urbanphoenix.db` file, update `ADMIN_EMAIL`/`ADMIN_PASSWORD`
in `.env`, and start the server again — this rebuilds the whole database
including a fresh admin account. If you don't want to lose orders/reviews,
ask whoever maintains this code to add a small script that inserts a new row
into `admin_users` instead (it's a one-line addition to `server/seed.mjs`).

## Deploying

This app is a single Node process, so it runs on any standard Node host
(a VPS, Render, Railway, Fly.io, etc.):

1. Upload the project (or `git clone` it) to the server.
2. `npm install`
3. Create `.env` with real values (`ADMIN_EMAIL`, `ADMIN_PASSWORD`, `JWT_SECRET`, `PORT`).
4. `npm run build`
5. `npm start` (or run it under a process manager like `pm2` or `systemd`
   so it restarts automatically).
6. Point your domain / reverse proxy (e.g. Nginx) at the `PORT` the server
   listens on.

Because everything lives in one SQLite file, there's no separate database
server to provision.

## API overview

Public (used by the storefront):
- `GET /api/products`, `GET /api/products/:id`
- `GET /api/editions?productId=...`
- `GET /api/reviews?productId=...`, `POST /api/reviews`
- `POST /api/orders`, `GET /api/orders/track/:orderNumber`

Admin (require `Authorization: Bearer <token>` from `POST /api/admin/login`):
- `GET /api/admin/overview`
- `GET/POST /api/admin/products`, `PUT/DELETE /api/admin/products/:id`
- `GET /api/admin/orders`, `PATCH /api/admin/orders/:id`
- `GET /api/admin/reviews`, `PATCH/DELETE /api/admin/reviews/:id`
- `GET /api/admin/editions`, `DELETE /api/admin/editions/:productId/:number`

## Still not connected (unchanged from the original frontend build)

Real payment gateway, live shipping rates, translated CMS content, exchange
rate API, and transactional email are still not wired up — the checkout flow
records orders in the database but does not charge cards. Connecting a
payment processor (Stripe, PayPal, etc.) is the natural next step once
you're ready to accept real payments.

## Demo values (frontend, unrelated to the new backend)

- Track order: use any order number created through checkout (format `UP-YYYY-XXXXXXXX`)
- Contact form: posts to the backend `POST /api/contact` endpoint, which emails
  `SUPPORT_EMAIL` (see `.env.example`'s SMTP section). Without SMTP configured,
  submissions are still accepted and logged to the server console instead of emailed.
