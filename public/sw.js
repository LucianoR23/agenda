/* Agenda service worker (hand-written; D77).
 * - App shell: navigations network-first, falling back to the cached shell offline.
 * - /_next/static: cache-first (hashed, immutable). Icons/fonts: stale-while-revalidate.
 * - /api is never cached here: the app keeps its own IndexedDB cache + write outbox.
 * - Web Push: shows the notification and opens the right screen on tap.
 */
const VERSION = "agenda-v1";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const SHELL_URLS = ["/", "/tareas", "/historial", "/metricas", "/ajustes", "/icons.svg", "/icons/icon-192.png", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => Promise.all(SHELL_URLS.map((u) => c.add(u).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(url.pathname, copy));
          return res;
        })
        .catch(async () => (await caches.match(url.pathname)) || (await caches.match("/")) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(STATIC).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      const net = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(STATIC).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});

self.addEventListener("push", (event) => {
  let msg = { title: "Agenda", body: "", url: "/", tag: undefined };
  try {
    msg = { ...msg, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(msg.title, {
      body: msg.body,
      tag: msg.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      data: { url: msg.url },
      vibrate: [40, 30, 40],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url);
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
