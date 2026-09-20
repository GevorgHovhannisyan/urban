import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { all, get, run, fromJson } from "./db.mjs";
import { uploadsDir } from "./uploads.mjs";

const clean = (value, max = 300) =>
  String(value ?? "")
    .trim()
    .slice(0, max);

function serialize(row) {
  if (!row) return null;
  return {
    id: row.id,
    filename: row.filename,
    url: row.url,
    mimeType: row.mimeType,
    kind: row.kind,
    width: row.width,
    height: row.height,
    sizeBytes: row.sizeBytes,
    alt: row.alt || "",
    uploadedAt: row.uploadedAt,
  };
}

// Called once, right after a file is written to public/uploads/ by the
// existing multer upload handlers (server/app.mjs) — this is the ONLY
// writer of this table; the Media Library never stores or moves files
// itself, only metadata about a file that already exists on disk (or, if
// this app later moves to cloud/object storage, a URL pointing at one).
export async function recordMedia({
  filename,
  url,
  mimeType,
  kind,
  width,
  height,
  sizeBytes,
}) {
  const id = randomUUID();
  await run(
    "INSERT INTO media (id, filename, url, mimeType, kind, width, height, sizeBytes, alt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      id,
      clean(filename, 255),
      clean(url, 500),
      clean(mimeType, 100),
      kind === "video" ? "video" : "image",
      width ?? null,
      height ?? null,
      Number(sizeBytes) || 0,
      "",
    ],
  );
  return serialize(await get("SELECT * FROM media WHERE id = ?", [id]));
}

export async function listMedia() {
  const rows = await all("SELECT * FROM media ORDER BY uploadedAt DESC");
  return rows.map(serialize);
}

export async function updateMediaAlt(id, alt) {
  const mediaId = clean(id, 80);
  const existing = await get("SELECT id FROM media WHERE id = ?", [mediaId]);
  if (!existing) return { status: 404, body: { error: "Media not found." } };
  await run("UPDATE media SET alt = ? WHERE id = ?", [
    clean(alt, 300),
    mediaId,
  ]);
  return {
    status: 200,
    body: {
      media: serialize(
        await get("SELECT * FROM media WHERE id = ?", [mediaId]),
      ),
    },
  };
}

// Recursively walks any JSON-shaped value (site_content's `data` column,
// a product's `images`/`garmentExplorer`, etc.) looking for a string that
// equals `url` exactly. Generic on purpose — a real CMS keeps adding new
// image-bearing fields over time (see content-api.mjs's DEFAULTS), and this
// never needs updating when that happens, unlike a hardcoded list of "the
// fields that currently hold images" would.
function containsUrl(value, url) {
  if (typeof value === "string") return value === url;
  if (Array.isArray(value)) return value.some((item) => containsUrl(item, url));
  if (value && typeof value === "object")
    return Object.values(value).some((v) => containsUrl(v, url));
  return false;
}

const SITE_CONTENT_LABELS = {
  homeHero: "Home → Hero",
  homeBanner: "Home → Collection Banner",
  aboutStory: "About → Origin Story",
  shopMenuVideo: "Navigation → Shop Menu Video",
  community: "Home → Community Grid",
  collection001: "Collections → Collection 001",
  collection002: "Collections → Collection 002",
};

// Real, live "is this actually used anywhere" check — never a guess, and
// never based on filename conventions. Checked, in order, against every
// place this app can store an uploaded file's URL: CMS content sections,
// product galleries/Garment Explorer images, and Journal cover images.
// Returns a list of human-readable locations (empty = safe to delete).
export async function findMediaUsage(url) {
  const locations = [];

  const contentRows = await all("SELECT section, data FROM site_content");
  for (const row of contentRows) {
    // mysql2 already parses a JSON-typed column into a real JS value — see
    // db.mjs's fromJson() comment; a raw JSON.parse(row.data) here would
    // throw on that (non-string) value and, if swallowed, silently make
    // every image look unused regardless of where it's really referenced.
    const data = fromJson(row.data, {});
    if (containsUrl(data, url))
      locations.push(
        SITE_CONTENT_LABELS[row.section] || `Site Content → ${row.section}`,
      );
  }

  const productRows = await all(
    "SELECT id, name, images, garmentExplorer FROM products WHERE archived = 0",
  );
  for (const row of productRows) {
    const images = fromJson(row.images, []);
    const explorer = fromJson(row.garmentExplorer, null);
    if (Array.isArray(images) && images.includes(url))
      locations.push(`Product → ${row.name} (gallery)`);
    if (explorer && containsUrl(explorer, url))
      locations.push(`Product → ${row.name} (Garment Explorer)`);
  }

  const journalRows = await all(
    "SELECT id, title, coverImage FROM journal_posts",
  );
  for (const row of journalRows) {
    if (row.coverImage === url) locations.push(`Journal → ${row.title}`);
  }

  return locations;
}

// Read-only usage check for the Admin UI's delete-confirmation step — the
// same lookup deleteMedia() itself does, exposed separately so the Admin
// panel can show the warning BEFORE the admin has committed to deleting
// anything, rather than only finding out by attempting the delete.
export async function getMediaUsageById(id) {
  const mediaId = clean(id, 80);
  const existing = await get("SELECT * FROM media WHERE id = ?", [mediaId]);
  if (!existing) return { status: 404, body: { error: "Media not found." } };
  return { status: 200, body: { usage: await findMediaUsage(existing.url) } };
}

// Deletes both the DB row and the underlying file — refuses when the
// asset is still referenced anywhere (findMediaUsage), forcing the admin
// to remove/replace the reference first rather than silently breaking a
// live page with a dangling image URL. `force` exists only for an admin
// who has confirmed the warning and wants to proceed anyway (e.g. the
// asset is used somewhere this scan can't see, or they're cleaning up a
// known-stale reference intentionally) — the confirmation itself happens
// in the Admin UI, this is just what lets that confirmed request through.
export async function deleteMedia(id, { force = false } = {}) {
  const mediaId = clean(id, 80);
  const existing = await get("SELECT * FROM media WHERE id = ?", [mediaId]);
  if (!existing) return { status: 404, body: { error: "Media not found." } };

  const usage = await findMediaUsage(existing.url);
  if (usage.length && !force) {
    return {
      status: 409,
      body: {
        error: "This file is currently in use and was not deleted.",
        usage,
      },
    };
  }

  await run("DELETE FROM media WHERE id = ?", [mediaId]);

  // Best-effort disk cleanup — the DB row (the thing every other API
  // actually reads) is already gone regardless of whether this succeeds,
  // and the upload directory is resolved once, not from client input, so
  // this can never touch a path outside it.
  try {
    const filePath = path.join(uploadsDir, path.basename(existing.filename));
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* non-fatal — DB is the source of truth for the Media Library listing */
  }

  return { status: 200, body: { deleted: true, usage } };
}
