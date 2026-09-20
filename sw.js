const VERSION = '1.9.3';
const CACHE = 'jellystash-' + VERSION;

// NOTE: do not list './' or './index.html' with a trailing-slash mismatch.
// Cloudflare Pages canonicalises /index.html -> / with a redirect, and a
// redirected Response can never be returned for a navigation on iOS Safari
// ("Response served by service worker has redirections"). We cache './'
// only, and strip the redirect flag defensively below.
const ASSETS = [
  './',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/fonts/baloo-2-latin-800-normal.woff2',
  './vendor/fonts/baloo-2-latin-700-normal.woff2',
  './vendor/fonts/baloo-2-latin-600-normal.woff2'
];
// The barcode scanner is big and rarely used, so it isn't precached — but
// once it's been fetched, the runtime cache below keeps it for offline use.

// A redirected response cannot be used for a navigation. Rebuild it as a
// plain response carrying the same body, status and headers.
async function stripRedirect(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers
  });
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      for (const url of ASSETS) {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) await c.put(url, await stripRedirect(res));
        } catch (err) {
          // a single failed asset shouldn't block the install
        }
      }
      // Updates are forced, not offered: a new build takes over as soon as
      // it has installed, and the page reloads onto it.
      await self.skipWaiting();
    })
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // live data (sync, photos, barcode lookups) must never come from the cache
  if (url.pathname.startsWith('/api/') || url.pathname === '/version.json') return;

  // Navigations: serve the cached shell straight away so launching is instant,
  // and refresh it in the background. Freshness is handled separately: the app
  // checks /version.json and updates itself when a new build is live.
  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      const cached = await caches.match('./');
      const network = fetch(e.request).then(async res => {
        if (res && res.ok) {
          const clean = await stripRedirect(res.clone());
          caches.open(CACHE).then(c => c.put('./', clean));
        }
        return stripRedirect(res);
      }).catch(() => null);
      if (cached) { e.waitUntil(network); return cached; }
      return (await network) || (await caches.match('./index.html')) || Response.error();
    })());
    return;
  }

  e.respondWith((async () => {
    const hit = await caches.match(e.request);
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok && !res.redirected) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    } catch (err) {
      return (await caches.match('./')) || Response.error();
    }
  })());
});
