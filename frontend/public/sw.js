// Service worker: makes the app installable, keeps the static shell
// available offline, and — the reason it now matters — receives Web Push
// so "notify me when this is free" can fire with the browser closed.
//
// API and WebSocket responses are deliberately never cached here. Live data
// served from a cache would be worse than no data: the app exists to tell
// you what is free right now. Last-known values are cached in
// localStorage instead (src/lib/cache.js), where the UI can label them
// with their age rather than passing them off as current.
const CACHE_NAME = 'gym-tracker-shell-v2';
const SHELL_ASSETS = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

self.addEventListener('push', (event) => {
  // A push with no readable body still deserves a notification: on most
  // browsers, failing to show one after waking for a push is a visible
  // violation that can cost the origin its push permission.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || 'GymPulse';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || 'A machine you were watching is now open.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // Collapses repeats for the same machine instead of stacking them.
      tag: data.machineId ? `machine-${data.machineId}` : 'gympulse',
      data: { gymId: data.gymId ?? null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const gymId = event.notification.data?.gymId;
  const target = gymId ? `/gym/${gymId}` : '/';

  // Reuse an already-open tab rather than piling up new ones, since the
  // point is to get the person back to the machine list they were on.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
