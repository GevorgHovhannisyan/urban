import fs from "node:fs";
import path from "node:path";
import { getProduct } from "./products-api.mjs";
import { getPostBySlug } from "./journal-api.mjs";
import { getSiteContent } from "./content-api.mjs";
import {
  DEFAULT_OG_IMAGE,
  KNOWN_PAGES,
  collectionPageMeta,
  journalPostMeta,
  pageToPath,
  pathToPageInfo,
  productPageMeta,
  staticPageMeta,
} from "../src/seo/pageMeta.js";

// Missing files under these prefixes get a plain 404 instead of the
// storefront HTML (a broken image URL shouldn't download a whole page).
const ASSET_PREFIXES = ["/uploads/", "/assets/", "/images/"];

const escapeAttr = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

// Tags this module owns. Stripped from the built index.html and written
// fresh for each URL, so there's exactly one of each.
const OWNED_TAGS = [
  /<title>[\s\S]*?<\/title>\s*/i,
  /<meta\s+name="description"[^>]*>\s*/i,
  /<meta\s+property="og:(?:title|description|image|url)"[^>]*>\s*/gi,
  /<meta\s+name="twitter:(?:title|description|image)"[^>]*>\s*/gi,
  /<link\s+rel="canonical"[^>]*>\s*/gi,
  /<meta\s+name="robots"[^>]*>\s*/gi,
];

function absolute(base, url) {
  if (!url) return url;
  try {
    return new URL(url, `${base}/`).href;
  } catch {
    return url;
  }
}

function renderHead(template, { title, description, image, canonical, noindex }) {
  let html = template;
  for (const pattern of OWNED_TAGS) html = html.replace(pattern, "");
  const tags = [
    `<title>${escapeAttr(title)}</title>`,
    `<meta name="description" content="${escapeAttr(description)}" />`,
    noindex ? `<meta name="robots" content="noindex" />` : `<link rel="canonical" href="${escapeAttr(canonical)}" />`,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
    `<meta property="og:image" content="${escapeAttr(image)}" />`,
    `<meta property="og:url" content="${escapeAttr(canonical)}" />`,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
    `<meta name="twitter:image" content="${escapeAttr(image)}" />`,
  ].join("\n  ");
  return html.replace(/<\/head>/i, `  ${tags}\n</head>`);
}

// Works out the HTTP status and <head> tags for a storefront URL.
// Returns status 404 for anything the SPA would render as "Page not found".
export async function resolveRoute(pathname) {
  const info = pathToPageInfo(pathname);
  const { page } = info;
  if (!KNOWN_PAGES.has(page)) return { status: 404, meta: staticPageMeta("not-found") };
  try {
    if (page === "product") {
      const product = await getProduct(info.productId, { isLoggedIn: false });
      if (!product || product.archived) return { status: 404, meta: staticPageMeta("not-found") };
      return { status: 200, meta: productPageMeta(product), path: pageToPath("product", { id: product.id }) };
    }
    if (page === "journal-post") {
      const post = await getPostBySlug(info.slug);
      if (!post) return { status: 404, meta: staticPageMeta("not-found") };
      return { status: 200, meta: journalPostMeta(post), path: pageToPath("journal-post", { slug: post.slug }) };
    }
    if (page === "collection") {
      const content = await getSiteContent();
      return { status: 200, meta: collectionPageMeta(content.collection001) };
    }
  } catch (error) {
    // Database hiccup: still serve the page (the SPA fetches its own data),
    // just with the generic tags — never a false 404.
    console.error(`[seo] ${pathname}: ${error.message}`);
    if (page === "product" || page === "journal-post") return { status: 200, meta: staticPageMeta(page === "product" ? "shop" : "journal") };
  }
  return { status: 200, meta: staticPageMeta(page) };
}

export function storefrontHandler(dist) {
  const indexPath = path.join(dist, "index.html");
  let cached = null;
  const template = () => {
    const mtime = fs.statSync(indexPath).mtimeMs;
    if (!cached || cached.mtime !== mtime) cached = { mtime, html: fs.readFileSync(indexPath, "utf8") };
    return cached.html;
  };

  return async (req, res, next) => {
    try {
      if (ASSET_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
        return res.status(404).type("text/plain").send("Not found");
      }
      res.setHeader("Cache-Control", "no-cache");
      // The admin panel is part of the same SPA bundle; it has no public meta.
      if (req.path === "/admin" || req.path.startsWith("/admin/")) {
        return res.type("html").send(template());
      }
      const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
      const { status, meta, path: routePath } = await resolveRoute(req.path);
      const canonicalPath = routePath || pageToPath(pathToPageInfo(req.path).page);
      const html = renderHead(template(), {
        title: meta.title,
        description: meta.description,
        image: absolute(base, meta.image || DEFAULT_OG_IMAGE),
        canonical: `${base}${canonicalPath}`,
        // Receipts are private (secret link); never indexed.
        noindex: status === 404 || pathToPageInfo(req.path).page === 'receipt',
      });
      return res.status(status).type("html").send(html);
    } catch (error) {
      console.error(`[seo] ${req.path}: ${error.message}`);
      if (res.headersSent) return next(error);
      // Fall back to the plain SPA shell rather than an error page.
      return res.sendFile(indexPath, (sendError) => sendError && next(sendError));
    }
  };
}
