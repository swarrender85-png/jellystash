// Barcode lookup for the "scan a tag" flow.
//
// Jellycat publishes no product API and its website terms forbid scraping,
// so we never touch jellycat.com. Instead we ask UPCitemdb, a public barcode
// database, using its free keyless tier (100 lookups a day, counted per IP).
//
// Every answer is cached in R2 under upc/<barcode>, so each barcode costs
// one upstream lookup ever, no matter how many devices scan it. Product
// data is not personal, so the cache is shared rather than per sync code.

const UPSTREAM = "https://api.upcitemdb.com/prod/trial/lookup?upc=";
const MISS_TTL_MS = 7 * 86400000; // retry "not found" barcodes after a week
const MAX_CACHE_BODY = 32 * 1024;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}
function readUpc(request) {
  const raw = new URL(request.url).searchParams.get("upc") || "";
  const upc = raw.replace(/[^0-9]/g, "");
  return upc.length >= 8 && upc.length <= 14 ? upc : null;
}
function clean(s, max) {
  return typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max || 300) : "";
}
// keep only the fields the app uses, from whichever shape we were given
function shape(item, upc) {
  if (!item || typeof item !== "object") return null;
  const images = (Array.isArray(item.images) ? item.images : [])
    .filter(u => typeof u === "string" && /^https:\/\//i.test(u))
    .slice(0, 6);
  const title = clean(item.title, 200);
  if (!title) return null;
  return {
    upc,
    title,
    brand: clean(item.brand, 80),
    description: clean(item.description, 1200),
    size: clean(item.size, 60),
    color: clean(item.color, 60),
    model: clean(item.model, 60),
    images
  };
}

export async function onRequestGet({ request, env }) {
  const upc = readUpc(request);
  if (!upc) return json({ error: "A barcode of 8 to 14 digits is required" }, 400);
  const key = "upc/" + upc;

  const hit = await env.SYNC_BUCKET.get(key);
  if (hit) {
    try {
      const c = JSON.parse(await hit.text());
      if (c.found || Date.now() - (c.at || 0) < MISS_TTL_MS) return json({ ...c, cached: true });
    } catch (e) { /* unreadable cache entry: fall through and refresh it */ }
  }

  let res;
  try {
    res = await fetch(UPSTREAM + upc, {
      headers: { accept: "application/json", "user-agent": "JellyStash/1.0 (personal collection app)" },
      signal: AbortSignal.timeout(8000)
    });
  } catch (e) {
    return json({ error: "upstream", detail: "The barcode database didn't answer" }, 502);
  }
  if (res.status === 429) return json({ error: "limit", detail: "Daily lookup limit reached" }, 429);
  if (!res.ok && res.status !== 404) return json({ error: "upstream", detail: "Barcode database error " + res.status }, 502);

  let data = {};
  try { data = await res.json(); } catch (e) { data = {}; }
  if (data.code === "EXCEED_LIMIT" || data.code === "TOO_FAST") {
    return json({ error: "limit", detail: "Daily lookup limit reached" }, 429);
  }
  const product = shape(Array.isArray(data.items) ? data.items[0] : null, upc);
  const record = product ? { found: true, product, at: Date.now() } : { found: false, at: Date.now() };
  await env.SYNC_BUCKET.put(key, JSON.stringify(record), { httpMetadata: { contentType: "application/json" } });
  return json({ ...record, cached: false });
}

// When the shared server IP has used up its daily allowance, the phone
// looks the barcode up directly (its own allowance) and hands the answer
// back here so every other scan of that barcode is served from cache.
export async function onRequestPost({ request, env }) {
  const upc = readUpc(request);
  if (!upc) return json({ error: "A barcode of 8 to 14 digits is required" }, 400);
  const len = Number(request.headers.get("content-length") || 0);
  if (len > MAX_CACHE_BODY) return json({ error: "Too large" }, 400);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: "Body must be JSON" }, 400); }
  const product = shape(body && body.product, upc);
  if (!product) return json({ error: "No usable product" }, 400);
  const key = "upc/" + upc;
  const existing = await env.SYNC_BUCKET.head(key);
  if (!existing) {
    await env.SYNC_BUCKET.put(key, JSON.stringify({ found: true, product, at: Date.now() }), {
      httpMetadata: { contentType: "application/json" }
    });
  }
  return json({ ok: true });
}
