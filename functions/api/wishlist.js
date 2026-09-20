// Shareable wishlist.
//
// The owner's app publishes a small snapshot of the wishlist (names, sizes and
// thumbnails, nothing else) under a random share id. Anyone with the link can
// read it at /w/<id> and quietly reserve a Jelly so family don't double up.
//
// R2 layout (bucket SYNC_BUCKET):
//   wish/<id>.json      snapshot + SHA-256 of the owner key (only the owner can change it)
//   wish/<id>.res.json  reservations, kept apart so republishing never wipes them
//
// The owner's app never asks for reservations, so the surprise is kept.

const MAX_SNAPSHOT = 3 * 1024 * 1024;
const MAX_ITEMS = 200;

const json = (obj, status) => new Response(JSON.stringify(obj), {
  status: status || 200,
  headers: { "content-type": "application/json", "cache-control": "no-store" }
});
const bad = (msg, status) => json({ error: msg }, status || 400);

function readId(url) {
  const id = (url.searchParams.get("id") || "").trim();
  return /^[A-Za-z0-9]{8,32}$/.test(id) ? id : null;
}
async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("jellystash-wish:" + text));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanItem(i) {
  if (!i || typeof i !== "object") return null;
  const thumb = typeof i.thumb === "string" && /^data:image\/(jpeg|png|webp);base64,/.test(i.thumb) && i.thumb.length < 200000 ? i.thumb : "";
  const ref = typeof i.ref === "string" && /^https:\/\//.test(i.ref) ? i.ref.slice(0, 500) : "";
  const id = str(i.id, 40);
  if (!id) return null;
  return {
    id, name: str(i.name, 120), size: str(i.size, 30), range: str(i.range, 60),
    kind: str(i.kind, 40), code: str(i.code, 20), note: str(i.note, 300), thumb, ref
  };
}
async function readJSON(env, key) {
  const o = await env.SYNC_BUCKET.get(key);
  if (!o) return null;
  try { return JSON.parse(await o.text()); } catch (e) { return null; }
}
const putJSON = (env, key, obj) => env.SYNC_BUCKET.put(key, JSON.stringify(obj), { httpMetadata: { contentType: "application/json" } });

// public read, used by the family page
export async function onRequestGet({ request, env }) {
  const id = readId(new URL(request.url));
  if (!id) return bad("Missing wishlist id");
  const snap = await readJSON(env, "wish/" + id + ".json");
  if (!snap) return json({ found: false }, 404);
  const res = (await readJSON(env, "wish/" + id + ".res.json")) || {};
  const reserved = {};
  for (const [itemId, r] of Object.entries(res)) reserved[itemId] = { at: r.at, by: r.by || "" };
  return json({ found: true, title: snap.title, updatedAt: snap.updatedAt, items: snap.items, reserved });
}

// owner publishes (needs the owner key)
export async function onRequestPut({ request, env }) {
  const id = readId(new URL(request.url));
  if (!id) return bad("Missing wishlist id");
  if (Number(request.headers.get("content-length") || 0) > MAX_SNAPSHOT) return bad("Wishlist too large");
  let body;
  try { body = await request.json(); } catch (e) { return bad("Body must be JSON"); }
  const key = str(body.key, 100);
  if (key.length < 16) return bad("Missing owner key", 403);
  const keyHash = await sha(key);
  const existing = await readJSON(env, "wish/" + id + ".json");
  if (existing && existing.keyHash !== keyHash) return bad("Not your wishlist", 403);
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean);
  await putJSON(env, "wish/" + id + ".json", {
    keyHash, title: str(body.title, 80) || "Jelly wishlist", updatedAt: new Date().toISOString(), items
  });
  // drop reservations for Jellies that have left the wishlist
  const res = await readJSON(env, "wish/" + id + ".res.json");
  if (res) {
    const live = new Set(items.map(i => i.id));
    let changed = false;
    for (const k of Object.keys(res)) if (!live.has(k)) { delete res[k]; changed = true; }
    if (changed) await putJSON(env, "wish/" + id + ".res.json", res);
  }
  return json({ ok: true, count: items.length });
}

// family reserve / unreserve a Jelly
export async function onRequestPost({ request, env }) {
  const id = readId(new URL(request.url));
  if (!id) return bad("Missing wishlist id");
  let body;
  try { body = await request.json(); } catch (e) { return bad("Body must be JSON"); }
  const snap = await readJSON(env, "wish/" + id + ".json");
  if (!snap) return bad("Wishlist not found", 404);
  const itemId = str(body.itemId, 40);
  if (!snap.items.some(i => i.id === itemId)) return bad("That Jelly isn't on the wishlist", 404);
  const token = str(body.token, 100);
  if (token.length < 16) return bad("Missing token");
  const tokenHash = await sha("res:" + token);
  const res = (await readJSON(env, "wish/" + id + ".res.json")) || {};
  if (body.action === "reserve") {
    if (res[itemId] && res[itemId].tokenHash !== tokenHash) return bad("Someone has already reserved this one", 409);
    res[itemId] = { at: new Date().toISOString(), by: str(body.by, 40), tokenHash };
  } else if (body.action === "unreserve") {
    if (res[itemId] && res[itemId].tokenHash !== tokenHash) return bad("Only the person who reserved it can undo that", 403);
    delete res[itemId];
  } else return bad("Unknown action");
  await putJSON(env, "wish/" + id + ".res.json", res);
  return json({ ok: true });
}

// owner stops sharing
export async function onRequestDelete({ request, env }) {
  const id = readId(new URL(request.url));
  if (!id) return bad("Missing wishlist id");
  const key = str(new URL(request.url).searchParams.get("key"), 100);
  const snap = await readJSON(env, "wish/" + id + ".json");
  if (!snap) return json({ ok: true });
  if (snap.keyHash !== await sha(key)) return bad("Not your wishlist", 403);
  await env.SYNC_BUCKET.delete(["wish/" + id + ".json", "wish/" + id + ".res.json"]);
  return json({ ok: true });
}
