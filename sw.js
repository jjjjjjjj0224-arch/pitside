// PitSide service worker.
// It saves a copy of every app file (the "app shell") the first time the app
// loads, then always answers from that copy, so the app opens with no internet.
//
// When you change any app file, bump VERSION so phones download the new files.

const VERSION = 'pitside-v1.3.0';

// Every file the app needs. Paths are relative to this file, so the app also
// works from a sub-folder (for example GitHub Pages: /your-repo/).
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/router.js',
  './js/ui.js',
  './js/db.js',
  './js/settings.js',
  './js/image.js',
  './js/draw.js',
  './js/recorder.js',
  './js/render.js',
  './js/zip.js',
  './js/exporter.js',
  './js/config.js',
  './js/cloud.js',
  './js/team.js',
  './js/sync.js',
  './js/gallery.js',
  './js/viewer.js',
  './js/webp.js',
  // (js/vendor/webp/* is cached the first time an iPhone needs it, not up front.)
  './js/screens/welcome.js',
  './js/screens/home.js',
  './js/screens/capture.js',
  './js/screens/saved.js',
  './js/screens/detail.js',
  './js/screens/export.js',
  './js/screens/settings.js',
  './js/screens/team.js',
  './js/screens/teamEntry.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

// Install: download all app files into a new cache.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

// Activate: delete caches from older versions.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Fetch: answer from the cache first ("cache first"). Only go to the network
// for something that isn't cached yet.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // Team sync requests (Supabase) go straight to the internet, never the cache.
  if (new URL(req.url).origin !== self.location.origin) return;

  // Opening the app (any page URL) always gets the cached index.html.
  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => cached || fetch(req))
    );
    return;
  }

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    })
  );
});
