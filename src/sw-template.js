/* Splash Rush service worker (generated at build time; see vite.config.js).
 * - Precaches the whole build so the game starts offline after the first visit.
 * - Everything is keyed by this worker's SCOPE PATH, so other apps/PWAs on the same origin are never touched:
 *     * caches are named  splash-rush:<scope path>:<build hash>  and only those with our own prefix are pruned
 *     * fetches outside the scope (or cross-origin, or non-GET) are ignored entirely
 */
const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;

const SCOPE = new URL(self.registration.scope);
const PREFIX = `splash-rush:${SCOPE.pathname}:`;
const CACHE = PREFIX + VERSION;
const INDEX = new URL('./index.html', SCOPE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(PRECACHE.map((p) => new Request(new URL(p, SCOPE).href, { cache: 'reload' })));
      // "./" is stored as the app shell too
      const shell = await cache.match(INDEX, { ignoreVary: true });
      if (shell) await cache.put(new URL('./', SCOPE).href, shell.clone());
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = (await cache.match(INDEX, { ignoreVary: true })) || (await cache.match(new URL('./', SCOPE).href, { ignoreVary: true }));
        if (hit) return hit;
        try { return await fetch(req); } catch { return Response.error(); }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      // ignoreVary: static hosts may send `Vary: Origin`, which would otherwise make CORS-mode module loads miss the precache
      const hit = await cache.match(req, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      } catch {
        return Response.error();
      }
    })(),
  );
});
