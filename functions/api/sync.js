// Cloudflare Pages Function — deploys automatically on every push, same as
// the rest of the site. Backs the "sync across devices" feature: each
// device pushes its full collection here and pulls the other device's, keyed by a
// shared code the person sets up once on each device.
//
// The code itself is never stored — only a SHA-256 hash of it is used as
// the R2 object key, so whoever holds the code can read/write that one
// object and nothing else. No accounts, no passwords, proportionate to a
// family app rather than bank-grade.

const MIN_CODE_LENGTH = 4;
const MAX_BODY_BYTES = 40 * 1024 * 1024; // 40MB — generous for a photo-heavy collection, not unlimited

async function hashCode(code) {
  const bytes = new TextEncoder().encode("jellystash-sync:" + code.trim().toLowerCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "content-type": "application/json" }
  });
}

function getCode(request) {
  const url = new URL(request.url);
  const code = (url.searchParams.get("code") || "").trim();
  return code.length >= MIN_CODE_LENGTH ? code : null;
}

export async function onRequestGet(context) {
  const code = getCode(context.request);
  if (!code) return badRequest("A sync code (at least " + MIN_CODE_LENGTH + " characters) is required");

  const key = await hashCode(code);
  const obj = await context.env.SYNC_BUCKET.get(key);
  if (!obj) {
    return new Response(JSON.stringify({ found: false }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }
  const body = await obj.text();
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

export async function onRequestPut(context) {
  const code = getCode(context.request);
  if (!code) return badRequest("A sync code (at least " + MIN_CODE_LENGTH + " characters) is required");

  const contentLength = Number(context.request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return badRequest("That collection is too large to sync in one go");

  const bodyText = await context.request.text();
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (err) {
    return badRequest("Body must be valid JSON");
  }
  if (!Array.isArray(parsed.items)) return badRequest("Body must include an items array");

  const key = await hashCode(code);
  await context.env.SYNC_BUCKET.put(key, bodyText, {
    httpMetadata: { contentType: "application/json" }
  });

  // NOTE: we deliberately do NOT verify every referenced photo here. Doing an
  // R2 head() per photo blew past the 50-subrequest limit on the Workers free
  // plan once a kit had a few dozen photos, which failed the whole sync. The
  // client self-heals instead: if a pull can't fetch a photo, it forgets that
  // it uploaded it and sends it again next time.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
