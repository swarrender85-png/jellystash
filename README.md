# JellyStash

A mobile-first PWA for showing off a plush collection. Scan the tag, type the style code, or snap a photo; every friend gets a card tinted to its own colour, and "Start the parade" plays the whole collection as a full-screen slideshow.

Works on iPhone, iPad and Android: open the site, then Add to Home Screen.

## How adding works

- **Scan the tag:** the camera reads the barcode (ZBar compiled to WebAssembly, since Safari has no built-in barcode detection). The barcode is checked against the collection first, then looked up in the public UPCitemdb database to fill in the name, range, kind and size.
- **Type the style code:** the short code on the paper tag or sewn-in loop (e.g. BAS3BTR). The app decodes the prefix (BAS3 → Bashful) from a small seed list plus everything already in the collection, so it gets smarter as she adds more.
- **Add by hand:** for tagless friends.

The app never reads the Jellycat website. Its terms of use prohibit automated access and data harvesting, so product details come only from UPCitemdb and from what's typed in.

## Files

```
index.html               the whole app
sw.js                    offline service worker (never caches /api/)
manifest.webmanifest     PWA manifest
functions/api/lookup.js  barcode lookup via UPCitemdb, cached in R2 under upc/
functions/api/sync.js    sync manifest per shared code
functions/api/photo.js   content-addressed photo storage for sync
vendor/                  ZBar WASM (LGPL-2.1+, unmodified)
```

## Hosting

Cloudflare Pages project `jellystash`, connected to this repo; every push to `main` deploys. R2 bucket `jellystash-sync` is bound as `SYNC_BUCKET`.

## Limits worth knowing

- UPCitemdb's free tier allows 100 lookups a day per IP. Every result is cached in R2, and if the server's allowance runs out the phone asks directly with its own allowance.


## Versions and forced updates

The version lives in three places that must match: `VERSION` in `index.html`, `VERSION` in `sw.js`, and `version.json`. Change all three at once with:

```
scripts/bump-version.sh 1.2.0
```

Installed copies check `version.json` on launch, when reopened, and every 15 minutes. If a newer version is live they update immediately (waiting only until any open form or scanner is closed), then reload. The current version is shown under More.

## Third-party code

`vendor/zbar-wasm.mjs` and `vendor/zbar.wasm` are the [@undecaf/zbar-wasm](https://github.com/undecaf/zbar-wasm) build of ZBar, used unmodified under the LGPL-2.1+ (see `vendor/zbar-wasm-LICENSE`).
