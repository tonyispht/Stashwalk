// Stashwalk service worker.
// Three jobs: launch instantly, keep working where there is no signal, and never
// cache anything that comes from the shared world database (that must always be live).
//
// VERSION must match window.ASSET_V in index.html - bump both together on every deploy.
const VERSION = '202611180630';
const SHELL   = 'stashwalk-shell-' + VERSION;   // app code, replaced on every deploy
const PLACES  = 'stashwalk-places-v1';          // park/campground tiles, never change
const TILES   = 'stashwalk-maptiles-v1';        // map images, capped below
const TILE_CAP = 600;
const ROADS   = 'stashwalk-roads-v1';           // street/trail vector tiles for road coins
const ROAD_CAP = 30;

// Everything needed to open the game with no connection at all.
const SHELL_FILES = [
  './',
  'index.html',
  'style.css',
  'config.js',
  'items.js',
  'relics.js',
  'db.js',
  'fx.js',
  'app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'places/index.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

const MAP_HOSTS = /(^|\.)(tile\.openstreetmap\.org|basemaps\.cartocdn\.com|tile\.opentopomap\.org)$/;
const CDN_HOSTS = /(^|\.)(unpkg\.com|cdnjs\.cloudflare\.com)$/;
const ROAD_HOST = 'tiles.openfreemap.org';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // One bad URL must not fail the whole install, so each file is added on its own.
    await Promise.all(SHELL_FILES.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, PLACES, TILES, ROADS]);
    for (const k of await caches.keys()) if (k.startsWith('stashwalk-') && !keep.has(k)) await caches.delete(k);
    if (self.registration.navigationPreload) try { await self.registration.navigationPreload.enable(); } catch (err) {}
    await self.clients.claim();
  })());
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (all.length) { all[0].focus(); all[0].postMessage({ openAdmin: true }); }
    else await self.clients.openWindow('./');
  })());
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'version') { const to = (e.ports && e.ports[0]) || e.source; if (to) to.postMessage({ sw: VERSION }); }
});

// Keep the map tile cache from growing without limit (roughly oldest-first).
async function trim(cacheName, cap) {
  const c = await caches.open(cacheName), keys = await c.keys();
  if (keys.length <= cap) return;
  for (const k of keys.slice(0, keys.length - cap)) await c.delete(k);
}

// key lets a cache ignore the ?v= build stamp, so a deploy does not re-download
// files whose contents never change.
async function cacheFirst(req, cacheName, cap, key) {
  const c = await caches.open(cacheName);
  const k = key || req;
  const hit = await c.match(k, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    await c.put(k, res.clone());
    if (cap) trim(cacheName, cap);
  }
  return res;
}

// Fresh when online, cached when not - used for the app's own code.
async function staleWhileRevalidate(req) {
  const c = await caches.open(SHELL);
  const hit = await c.match(req, { ignoreSearch: true, ignoreVary: true });
  const net = fetch(req).then(res => { if (res && res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
  return hit || (await net) || new Response('offline', { status: 503, statusText: 'offline' });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const sameOrigin = url.origin === self.location.origin;

  // The shared world (Cloudflare Worker) is always live - never served from a cache.
  if (!sameOrigin && !MAP_HOSTS.test(url.hostname) && !CDN_HOSTS.test(url.hostname) && url.hostname !== ROAD_HOST) return;

  // Road data: tiles are versioned in their URL, so keep them; the index that names the
  // current version changes monthly, so always ask for it fresh and fall back when offline.
  if (url.hostname === ROAD_HOST) {
    if (url.pathname.endsWith('.pbf')) { e.respondWith(cacheFirst(req, ROADS, ROAD_CAP).catch(() => Response.error())); return; }
    e.respondWith(fetch(req).then(async res => { if (res.ok) (await caches.open(ROADS)).put(req, res.clone()); return res; })
      .catch(async () => (await (await caches.open(ROADS)).match(req)) || Response.error()));
    return;
  }

  // Opening the app itself: try the network, fall back to the stored page.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const pre = await e.preloadResponse;
        if (pre) return pre;
        return await fetch(req);
      } catch (err) {
        const c = await caches.open(SHELL);
        return (await c.match('index.html', { ignoreSearch: true })) ||
               (await c.match('./', { ignoreSearch: true })) ||
               new Response('Stashwalk is offline and has nothing stored yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  if (MAP_HOSTS.test(url.hostname)) { e.respondWith(cacheFirst(req, TILES, TILE_CAP).catch(() => Response.error())); return; }
  if (CDN_HOSTS.test(url.hostname)) { e.respondWith(cacheFirst(req, SHELL).catch(() => Response.error())); return; }

  // Park and campground data: fixed files, so once stored they are good forever.
  if (sameOrigin && url.pathname.includes('/places/')) {
    e.respondWith(cacheFirst(req, PLACES, 0, url.origin + url.pathname).catch(() => Response.error()));
    return;
  }

  if (sameOrigin) e.respondWith(staleWhileRevalidate(req));
});
