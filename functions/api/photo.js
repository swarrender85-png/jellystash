// One R2 object per photo, keyed by the sync code's hash plus the photo's
// own content hash. A device uploads a photo once and every later sync
// only ships the manifest of hashes, not the image bytes.

const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MIN_CODE_LENGTH = 4;

async function hashCode(code) {
  const bytes = new TextEncoder().encode("plush-parade-sync:" + code.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: { "content-type": "application/json" } });
}
function params(request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim();
  const h = (url.searchParams.get("h") || "").toLowerCase();
  if (code.length < MIN_CODE_LENGTH) return { error: "A sync code is required" };
  if (!/^[0-9a-f]{64}$/.test(h)) return { error: "A valid photo hash is required" };
  return { code, h };
}

export async function onRequestGet(context) {
  const p = params(context.request);
  if (p.error) return json({ error: p.error }, 400);
  const key = (await hashCode(p.code)) + "/p/" + p.h;
  const obj = await context.env.SYNC_BUCKET.get(key);
  if (!obj) return json({ found: false }, 404);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": obj.httpMetadata?.contentType || "image/jpeg",
      // content-addressed, so it never changes: cache hard
      "cache-control": "private, max-age=31536000, immutable"
    }
  });
}

export async function onRequestPut(context) {
  const p = params(context.request);
  if (p.error) return json({ error: p.error }, 400);
  const len = Number(context.request.headers.get("content-length") || 0);
  if (len > MAX_PHOTO_BYTES) return json({ error: "Photo too large" }, 400);
  const bytes = await context.request.arrayBuffer();
  if (bytes.byteLength === 0) return json({ error: "Empty photo" }, 400);
  // verify the bytes really hash to the claimed key, so nothing can be filed under the wrong name
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actual = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  if (actual !== p.h) return json({ error: "Hash does not match content" }, 400);
  const key = (await hashCode(p.code)) + "/p/" + p.h;
  await context.env.SYNC_BUCKET.put(key, bytes, {
    httpMetadata: { contentType: context.request.headers.get("content-type") || "image/jpeg" }
  });
  return json({ ok: true });
}
