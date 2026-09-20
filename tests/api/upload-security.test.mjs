// Integration tests against a real Express server + isolated temp database.
// Regression/hardening: multer's fileFilter only ever saw the client-claimed
// Content-Type, which is trivially spoofable — a malicious file (e.g. an
// HTML/script payload) uploaded with a claimed "image/jpeg" Content-Type
// used to be accepted and saved under /uploads, a real stored-content risk
// since that directory is served back to browsers. Fixed by verifying the
// actual file bytes against each format's magic-number signature after
// upload (server/uploads.mjs's verifyUploadedFileContent).
//
// NOTE: uploadsDir (server/uploads.mjs) is NOT scoped by DB_PATH isolation —
// it's always the real project's public/uploads/ directory, unlike every
// other piece of state these tests touch. Any file this suite creates is
// explicitly tracked and deleted in after(), so the suite never leaves
// artifacts behind in real project storage.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, readdirSync } from "node:fs";
import path from "node:path";
import { startTestServer } from "../helpers/test-server.mjs";
import { uploadsDir } from "../../server/uploads.mjs";

let server;
let BASE;
let adminToken;
const createdFiles = [];

before(async () => {
  server = await startTestServer("upload-security");
  BASE = server.baseUrl;
  adminToken = await fetch(`${BASE}/api/admin/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  })
    .then((r) => r.json())
    .then((b) => b.token);
});

after(async () => {
  for (const file of createdFiles) {
    const full = path.join(uploadsDir, file);
    if (existsSync(full)) unlinkSync(full);
  }
  await server.close();
});

async function uploadFile(buffer, filename, claimedMimeType) {
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: claimedMimeType }), filename);
  const res = await fetch(`${BASE}/api/admin/uploads`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminToken}` },
    body: form,
  });
  const body = await res.json();
  if (body.url) createdFiles.push(body.url.replace("/uploads/", ""));
  return { status: res.status, body };
}

test("authorization: the upload endpoint requires an admin token", async () => {
  const form = new FormData();
  form.append(
    "file",
    new Blob([Buffer.from("x")], { type: "image/png" }),
    "x.png",
  );
  const res = await fetch(`${BASE}/api/admin/uploads`, {
    method: "POST",
    body: form,
  });
  assert.equal(res.status, 401);
});

test("a real PNG (correct magic bytes) is accepted", async () => {
  const realPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const result = await uploadFile(realPng, "real.png", "image/png");
  assert.equal(result.status, 200);
  assert.match(result.body.url, /^\/uploads\/.+\.png$/);
  assert.ok(
    existsSync(path.join(uploadsDir, result.body.url.replace("/uploads/", ""))),
    "the accepted file should actually exist on disk",
  );
});

test("SPOOFED upload: a file claiming image/jpeg but actually containing an HTML/script payload is rejected, not saved", async () => {
  const maliciousContent = Buffer.from(
    "<script>alert(document.cookie)</script>",
    "utf8",
  );
  const result = await uploadFile(maliciousContent, "fake.jpg", "image/jpeg");
  assert.equal(result.status, 400);
  assert.match(result.body.error, /valid image/i);
});

test("SPOOFED upload: a file claiming image/png but actually plain text is rejected", async () => {
  const result = await uploadFile(
    Buffer.from("just some plain text, not an image"),
    "notanimage.png",
    "image/png",
  );
  assert.equal(result.status, 400);
});

test("a rejected spoofed upload does not leave a file behind on disk", async () => {
  const before = new Set(readdirSync(uploadsDir));
  await uploadFile(Buffer.from("not a real image"), "evil.png", "image/png");
  const after = readdirSync(uploadsDir);
  const newFiles = after.filter((f) => !before.has(f));
  assert.equal(
    newFiles.length,
    0,
    `a rejected upload must be deleted, not left on disk — found new file(s): ${JSON.stringify(newFiles)}`,
  );
});
