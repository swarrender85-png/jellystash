# JellyStash

A mobile-first PWA for showing off a plush collection. Scan the tag, type the style code, or snap a photo; every friend gets a card tinted to its own colour, and "Show the Jellies" plays the whole collection as a full-screen slideshow.

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
functions/api/wishlist.js  shareable wishlist: publish, read, reserve (R2 under wish/)
wish.html                the family wishlist page, served at /w/<id> via _redirects
vendor/                  ZBar WASM (LGPL-2.1+, unmodified)
```

## Snap the tag (1.3)

"Snap the tag" takes one photo of the paper hang tag and reads it on the device: Tesseract (OCR) reads the name ("This is ..."), the collection line and the style code, and ZBar reads the barcode from the same photo, trying sideways too. If there's a barcode it's also looked up for size and a shop picture. Words mangled by a thumb or crease are repaired against the collection line and known ranges (e.g. "Jascables" becomes "Amuseables"). Nothing is sent anywhere except the optional barcode lookup. The reader (about 13 MB) downloads only the first time it's used.

## Jelly wall and games (1.8)

- **Jelly wall:** shelves of the whole stash. Press and drag to reorder; the order is a number per Jelly (fractional midpoints), so a move writes one record and syncs like anything else. The share button renders a poster PNG of the whole stash on a canvas.
- **Games:** Guess Who (a random 30% crop of one Jelly's photo, three names) and Memory match (pairs from her own photos, best score per size in localStorage). Both need photos on at least 3 Jellies.

## Features added in 1.2

- **Keeping data safe:** a banner asks for Add to Home Screen when opened in a browser (browsers can clear website data after a period without use), and one asks to turn on sync once there are 5 or more Jellies. One banner at a time, each can be snoozed.
- **Shareable wishlist:** the share button on the Wishlist makes a link (/w/<id>) with photos and sizes. Family can reserve a Jelly; the app itself never fetches reservations. The link updates itself when the wishlist changes, and its settings travel with sync.
- **Delight:** Jelly of the day, stash-iversaries, and colour filters (colour worked out from the photo, with a manual override).
- **Photo crop:** every photo goes through a square crop with drag and pinch.
- **Collector details:** tags, condition, and where it lives.

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

`vendor/tesseract/` is [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 with its LSTM WebAssembly cores and the `eng` 4.0.0_best_int language data, used unmodified under the Apache 2.0 licence (see the LICENSE files in that folder).


`vendor/zbar-wasm.mjs` and `vendor/zbar.wasm` are the [@undecaf/zbar-wasm](https://github.com/undecaf/zbar-wasm) build of ZBar, used unmodified under the LGPL-2.1+ (see `vendor/zbar-wasm-LICENSE`).
