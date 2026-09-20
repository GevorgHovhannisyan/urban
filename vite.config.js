import 'dotenv/config';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Mounts the exact same Express app (API + /admin panel) used in production
// (server.mjs) as Vite dev-server middleware, so the live preview has full
// backend parity — login, account, checkout, order tracking, promo codes,
// newsletter, and the admin dashboard all work here too, not just the
// product/review/order endpoints a hand-picked subset used to cover.
//
// Only relevant for `vite dev` (configureServer never runs for `vite build`),
// so every backend import (server/db.mjs, which throws immediately at import
// time if DB_USER is unset — see its own comment) is deliberately dynamic and
// deferred to configureServer, not a static top-level import. A plain
// `npm run build` only bundles the frontend and has no need for a live MySQL
// connection at all; requiring one there would break CI/build environments
// that never touch the database.
function backendApiPlugin() {
  return {
    name: 'urban-phoenix-backend-api',
    async configureServer(server) {
      const { initDb } = await import('./server/db.mjs');
      const { runSeed } = await import('./server/seed.mjs');
      const { createApp } = await import('./server/app.mjs');

      // Creates every table on a fresh 'urban' MySQL database (no-op once
      // they already exist) — must resolve before the dev server starts
      // handling API requests, same as server.mjs's production boot sequence.
      await initDb();
      await runSeed();

      server.middlewares.use(createApp({ allowFraming: true }));
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), backendApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
    // dist/: without this, the dev server's file watcher and a concurrent
    // `vite build` both touch dist/ at once, throwing an EBUSY error on
    // Windows that crashes the dev server entirely.
    // data/: admin-uploaded media (server/uploads.mjs) and the seed-fallback
    // JSON files live here. All real app data now lives in the MySQL 'urban'
    // database (server/db.mjs) instead, but uploads still land in this
    // directory, so it stays excluded from the watcher for the same reason
    // as before: an upload write shouldn't trigger a full page reload that
    // discards client state.
    // Anchored to the project-root `data/` only (no leading `**/`) — a
    // leading `**/` also matched `src/data/**`, which meant edits to
    // src/data/products.js, garmentExplorer.js, etc. were silently never
    // picked up by the dev server (it kept serving whatever it had already
    // transformed in memory) until a manual restart.
    watch: { ignored: ['**/dist/**', 'data/**'] },
  },
  preview: { host: '0.0.0.0', port: 4173 },
  esbuild: { jsx: 'automatic' },
});
