// Service Worker for NHL Calendar PWA
// Strategy: network-first for code files, cache-first for static assets.
//
// Why: code files (HTML, JS, CSS, manifest) change when you deploy.
// We always hit the network for these so users get the latest version
// immediately. If the network fails (offline), we fall back to cache.
//
// Static assets (images, icons, fonts) are slow to download and rarely
// change, so we serve them cache-first and silently update the cache
// in the background (stale-while-revalidate).
//
// NEVER bump CACHE_NAME for code changes anymore - it's automatic now.
// Only bump it if you need to forcibly purge ALL caches (rare).

const CACHE_NAME = 'nhl-calendar-v6-networkfirst';

// Files we pre-cache on install (so the app works offline on first visit).
const PRECACHE_URLS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.webmanifest',
    './icons/favicon.svg'
];

// Extensions that count as "code" - always network-first.
const CODE_EXTENSIONS = ['.html', '.js', '.css', '.json', '.webmanifest', '.manifest'];

// Extensions that count as "static assets" - cache-first + background update.
const ASSET_EXTENSIONS = ['.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.otf'];

// ---------- helpers ----------

function isCodeRequest(url) {
    const pathname = url.pathname.toLowerCase();
    // Root path or empty path == index.html (code).
    if (pathname === '/' || pathname === '') return true;
    return CODE_EXTENSIONS.some(ext => pathname.endsWith(ext));
}

function isAssetRequest(url) {
    const pathname = url.pathname.toLowerCase();
    return ASSET_EXTENSIONS.some(ext => pathname.endsWith(ext));
}

// ---------- install: pre-cache the shell ----------

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(PRECACHE_URLS))
            .then(() => self.skipWaiting())
    );
});

// ---------- fetch: route by request type ----------

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never intercept cross-origin requests (logos from assets.nhle.com, etc.)
    if (url.origin !== location.origin) {
        return;
    }

    // NEVER cache API calls - always go straight to network.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Navigation requests (page loads) - treat as code, network-first.
    if (event.request.mode === 'navigate') {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Code files - network-first so users always get the latest version.
    if (isCodeRequest(url)) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    // Static assets - cache-first with background revalidation.
    if (isAssetRequest(url)) {
        event.respondWith(staleWhileRevalidate(event.request));
        return;
    }

    // Everything else - try network, fall back to cache.
    event.respondWith(networkFirst(event.request));
});

// ---------- strategies ----------

// Network-first: try the network, fall back to cache if it fails.
// Always updates the cache with the latest response so it stays fresh.
async function networkFirst(request) {
    const cache = await caches.open(CACHE_NAME);
    try {
        const networkResponse = await fetch(request);
        // Only cache successful, basic (same-origin) responses.
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (err) {
        // Network failed (offline, DNS error, etc.) - try the cache.
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        // Nothing in cache either - rethrow so the browser shows its error page.
        throw err;
    }
}

// Stale-while-revalidate: serve cached version immediately if available,
// then fetch the latest in the background and update the cache.
async function staleWhileRevalidate(request) {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    }).catch(() => cachedResponse); // If fetch fails, we still have the cached one.

    // Return cached immediately if we have it, otherwise wait for network.
    return cachedResponse || fetchPromise;
}

// ---------- activate: clean up old caches + take control ----------

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                // Delete every cache that isn't the current one.
                // This purges the old v4/v5 caches from prior deploys automatically.
                return Promise.all(
                    cacheNames
                        .filter(name => name !== CACHE_NAME)
                        .map(name => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});
