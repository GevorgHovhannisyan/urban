# Deployment

The site runs on a DigitalOcean droplet as a single Node process (`server.mjs`)
behind Nginx, backed by a real MySQL database. Deploys are automated: a push to
`main` builds, tests, and ships itself.

## Server

- App directory: `/var/www/urban`, owned by the `gev` user
- Runs as a systemd service named `urban-phoenix`, listening on port `3000`
- MySQL database: `urban`, local to the droplet (not exposed externally)
- Nginx reverse-proxies `80`/`443` to `127.0.0.1:3000` and terminates TLS
  (Let's Encrypt via Certbot)
- SSH access is key-only; the droplet's own admin login uses a personal key,
  separate from the CI deploy key described below

Files the deploy process never touches, even on a full redeploy: `.env` and
the `uploads/` folder (see `PROTECT` in `scripts/deploy-remote.sh`).

## CI/CD (`.github/workflows/deploy.yml`)

Triggered on every push to `main`, or manually via **Actions → Run workflow**.

1. **`build` job** — checks out the repo, installs dependencies, and runs:
   - `npm run lint --if-present`
   - `npm test --if-present` (`test:unit` + `test:api`) against a throwaway
     `mysql:8.0` service container spun up just for this job
   - `npm run build --if-present` (Vite build → `dist/`)
   - packages the whole repo (minus `node_modules`, `.git`, `.github`, `.env`)
     into `release.tar.gz` and uploads it as a workflow artifact
2. **`deploy` job** — only runs if `build` succeeds:
   - downloads `release.tar.gz`
   - opens an SSH connection to the droplet (strict host key checking, a
     dedicated deploy-only key — see **Secrets** below)
   - `scp`s the tarball to `~/deploy/incoming/<commit-sha>.tar.gz`
   - runs `scripts/deploy-remote.sh <commit-sha>` on the droplet over SSH
   - always removes the SSH key from the runner afterward

Concurrency is set to queue (`cancel-in-progress: false`), so two pushes in
quick succession deploy one after another instead of racing each other.

### Required GitHub secrets (`production` environment)

| Secret | Purpose |
| --- | --- |
| `SSH_PRIVATE_KEY` | Private half of the deploy-only key authorized on the droplet |
| `SSH_KNOWN_HOSTS` | Output of `ssh-keyscan` for the droplet, pinned ahead of time |
| `SSH_HOST` | Droplet IP or domain |
| `SSH_PORT` | SSH port |
| `SSH_USER` | User the deploy runs as on the droplet (`gev`) |

## What `scripts/deploy-remote.sh` actually does on the server

Runs as root or `gev`, called by the GitHub Actions `deploy` job with one
argument: the commit SHA being deployed.

1. Unpacks the uploaded tarball into a staging folder (`~/deploy/staging`) —
   the live app keeps running untouched during this step
2. `npm ci --omit=dev` inside staging
3. Backs up the database: `mysqldump` → gzip → `~/deploy/backups/`, then
   prunes backups beyond the last 14
4. Copies the current live app aside to `~/deploy/previous` (the rollback
   target if this deploy turns out to be bad)
5. `rsync`s staging over `/var/www/urban` **in place**, excluding `.env` and
   `uploads/`
6. `sudo systemctl restart urban-phoenix`
7. Health-checks `http://127.0.0.1:3000/` for up to ~40 seconds
8. If the health check fails: restores `~/deploy/previous` over
   `/var/www/urban`, restarts the service again, and exits non-zero — so a
   broken deploy both self-heals on the server **and** shows red in GitHub
   Actions

## Fixes made while wiring this up

- **`.github/workflows/deploy.yml` had no database for its test step.**
  `tests/helpers/test-db.mjs` and `test-server.mjs` require a real, reachable
  MySQL server and throw immediately if `DB_USER` isn't set. Added a
  `mysql:8.0` service container plus `DB_HOST`/`DB_PORT`/`DB_USER`/
  `DB_PASSWORD`/`DB_NAME` to the `build` job so `npm test` can actually run in
  CI.
- **`server/admin-config-guard.mjs` had its real safety check disabled.** It's
  supposed to refuse to boot in production with an unset or default
  `ADMIN_PASSWORD`; the `throw` had been commented out and replaced with a
  `console.warn` that let the server start anyway. Restored the `throw` —
  this was a live security gap, not just a test failure.
- **`tests/unit/foreign-keys.test.mjs` inserted incomplete rows.** Its
  `customer_addresses` inserts omitted `phone`/`apartment`, which are
  `NOT NULL` with no default — unlike the real insert path in
  `server/account-api.mjs`, which always supplies both. MySQL's default
  strict mode (on in the CI `mysql:8.0` container) rejected the incomplete
  insert. Fixed the test inserts to match how the app actually writes that
  table.

## Redeploying / rolling back

- **Normal deploy:** push to `main`, or use **Actions → Run workflow**.
- **Roll back:** the previous release is kept at `~/deploy/previous` on the
  droplet after every deploy; restoring it is the same rsync-and-restart
  sequence `deploy-remote.sh` already runs automatically on a failed health
  check. There is currently no one-click rollback button in Actions — it's a
  manual SSH session if a bad deploy passes its health check but is still
  wrong in some other way.
- **Database backups:** `~/deploy/backups/` on the droplet, one gzip dump per
  deploy, last 14 kept. Copy these off the droplet periodically — a backup
  that only lives on the server it's protecting against isn't a backup.
