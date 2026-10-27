/* Service worker — makes the platform installable and usable offline.
 * App shell: cache-first with background refresh (stale-while-revalidate).
 * NASA archive (data/nasa/*): network-first, falls back to the last cached copy offline.
 * Bump VERSION on every release so phones pick up the new shell. */
const VERSION = 'gcsar-v0.9.2';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './js/engine/fao56.js', './js/engine/crops.js', './js/engine/soils.js', './js/engine/waterbalance.js', './js/balance-ui.js', './js/guide-ui.js',
  './data/syria_gov.js', './data/climate_template_v0.1.xlsx',
  './icons/icon-192.png', './icons/icon-512.png',
  'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { mode: u.startsWith('http') ? 'no-cors' : 'same-origin' })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // only the platform's own files and the pinned CDN library; never intercept external APIs (NASA POWER etc.)
  if (url.origin !== self.location.origin && !SHELL.includes(req.url)) return;
  if (url.pathname.includes('/data/nasa/') || url.pathname.includes('/data/forecast/') || url.pathname.endsWith('/access.json')) {           // fresh data when online, last copy when offline
    e.respondWith(fetch(req).then(r => { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); return r; })
      .catch(() => caches.match(req, { ignoreSearch: true })));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => {
    const net = fetch(req).then(r => { if (r && (r.ok || r.type === 'opaque')) { const cp = r.clone(); caches.open(VERSION).then(c => c.put(req, cp)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
