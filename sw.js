/**
 * sw.js — Service Worker for Finance Tracker PWA
 *
 * Strategy:
 *  - Local app files (HTML, JS, CSS): Network-first → cache fallback
 *    This ensures updates are always picked up immediately when online.
 *  - CDN resources (Chart.js, PDF.js): Cache-first → network fallback
 *    These rarely change; serve fast from cache.
 */

const CACHE_NAME = 'finance-app-v36';

// Base path — empty string when served from root, '/repo-name' on GitHub Pages
const BASE = '/finance-app';

// ─── App Shell — all local files to cache ─────────────────────────────────────
const APP_SHELL = [
  BASE + '/',
  BASE + '/index.html',
  BASE + '/css/variables.css',
  BASE + '/css/base.css',
  BASE + '/css/components.css',
  BASE + '/css/layout.css',
  BASE + '/js/chart.min.js',
  BASE + '/js/db.js',
  BASE + '/js/parsers.js',
  BASE + '/js/router.js',
  BASE + '/js/theme.js',
  BASE + '/js/app.js',
  BASE + '/js/upload.js',
  BASE + '/js/dashboard.js',
  BASE + '/js/transactions.js',
  BASE + '/js/analytics.js',
  BASE + '/js/settings.js',
  BASE + '/screens/dashboard.html',
  BASE + '/screens/upload.html',
  BASE + '/screens/transactions.html',
  BASE + '/screens/analytics.html',
  BASE + '/screens/settings.html',
  BASE + '/manifest.json',
];

// ─── CDN Resources ────────────────────────────────────────────────────────────
const CDN_RESOURCES = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
];

// ─── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  console.log('[SW] Installing v33...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Caching app shell');
        return cache.addAll([...APP_SHELL, ...CDN_RESOURCES]);
      })
      .then(() => {
        console.log('[SW] Install complete ✅');
        return self.skipWaiting();
      })
      .catch(err => {
        console.warn('[SW] Some resources failed to cache during install:', err);
        return self.skipWaiting();
      })
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log('[SW] Activating v11...');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => {
        console.log('[SW] Activate complete ✅');
        return self.clients.claim();
      })
  );
});

// ─── Fetch ────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // Skip browser extension requests
  if (url.protocol === 'chrome-extension:' || url.protocol === 'moz-extension:') return;

  // Skip non-http(s) requests
  if (!url.protocol.startsWith('http')) return;

  const isLocalFile = url.hostname === self.location.hostname;

  if (isLocalFile) {
    // ── Network-first for local app files ──────────────────────────────────
    // Always fetch from network first so code updates are picked up immediately.
    // Fall back to cache if offline.
    event.respondWith(
      fetch(event.request)
        .then(networkResponse => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => {
          // Offline — serve from cache
          return caches.match(event.request)
            .then(cached => cached || caches.match('/index.html'));
        })
    );
  } else {
    // ── Cache-first for CDN resources ──────────────────────────────────────
    // CDN files rarely change; serve from cache for speed.
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            // Update cache in background
            fetch(event.request).then(networkResponse => {
              if (networkResponse && networkResponse.status === 200) {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, networkResponse.clone());
                });
              }
            }).catch(() => {});
            return cachedResponse;
          }
          // Not cached — fetch from network
          return fetch(event.request).then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse.clone());
              });
            }
            return networkResponse;
          }).catch(() => new Response('Offline', { status: 503 }));
        })
    );
  }
});
