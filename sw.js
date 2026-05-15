// Via service worker — app shell + itinerary offline caching
// ── Bump these strings on every production deploy to invalidate stale caches ──
const SHELL_CACHE  = 'via-shell-v2';
const ITIN_CACHE   = 'via-itin-v2';

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/langs.js',
  '/posts.js',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,700;0,900;1,400;1,500;1,700&family=Source+Serif+4:ital,opsz,wght@0,8..60,300;0,8..60,400;1,8..60,300;1,8..60,400&family=Karla:wght@300;400;500;600&display=swap',
];

// ── Install: cache app shell ───────────────────────────────────────────────
self.addEventListener('install', function(e){
  e.waitUntil(
    caches.open(SHELL_CACHE).then(function(cache){
      return cache.addAll(SHELL_ASSETS);
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

// ── Activate: clean up old caches ─────────────────────────────────────────
self.addEventListener('activate', function(e){
  e.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.filter(function(k){ return k !== SHELL_CACHE && k !== ITIN_CACHE; })
            .map(function(k){ return caches.delete(k); })
      );
    }).then(function(){ return self.clients.claim(); })
  );
});

// ── Fetch: shell-first for navigation, network-first for API ──────────────
self.addEventListener('fetch', function(e){
  const url = new URL(e.request.url);

  // Skip non-GET, browser-extensions, and cross-origin API calls (Anthropic, Resend)
  if(e.request.method !== 'GET') return;
  if(url.origin !== location.origin && !url.hostname.includes('fonts.g')) return;

  // Navigation requests → shell (index.html)
  if(e.request.mode === 'navigate'){
    e.respondWith(
      fetch(e.request).catch(function(){
        return caches.match('/index.html');
      })
    );
    return;
  }

  // langs.js / posts.js / fonts → cache-first (they change rarely)
  if(url.pathname === '/langs.js' || url.pathname === '/posts.js' || url.hostname.includes('fonts.g')){
    e.respondWith(
      caches.match(e.request).then(function(cached){
        return cached || fetch(e.request).then(function(resp){
          const clone = resp.clone();
          caches.open(SHELL_CACHE).then(function(c){ c.put(e.request, clone); });
          return resp;
        });
      })
    );
    return;
  }

  // All other same-origin: network-first, fall back to cache
  e.respondWith(
    fetch(e.request).catch(function(){
      return caches.match(e.request);
    })
  );
});

// ── Message: cache or retrieve saved itinerary ────────────────────────────
self.addEventListener('message', function(e){
  if(!e.data) return;

  if(e.data.type === 'SAVE_ITIN'){
    // Persist the itinerary JSON blob so it's readable offline
    caches.open(ITIN_CACHE).then(function(cache){
      const resp = new Response(JSON.stringify(e.data.payload), {
        headers: { 'Content-Type': 'application/json' }
      });
      cache.put('/offline-itin', resp);
    });
  }

  if(e.data.type === 'LOAD_ITIN'){
    caches.open(ITIN_CACHE).then(function(cache){
      cache.match('/offline-itin').then(function(resp){
        if(resp) resp.json().then(function(data){
          e.source.postMessage({ type: 'ITIN_DATA', payload: data });
        });
        else e.source.postMessage({ type: 'ITIN_DATA', payload: null });
      });
    });
  }
});
