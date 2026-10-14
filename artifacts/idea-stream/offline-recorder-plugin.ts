import { createHash } from "node:crypto";
import type { Plugin } from "vite";

/** Cache only the built application shell. Never cache API responses, uploads, or user content. */
export function offlineRecorderShell(): Plugin {
  let base = "/";
  return {
    name: "offline-recorder-shell",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      base = config.base;
    },
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((file) =>
        /\.(?:js|css|html|woff2)$/.test(file),
      );
      const hash = createHash("sha256");
      for (const file of files.sort()) {
        const output = bundle[file];
        hash
          .update(file)
          .update(output.type === "chunk" ? output.code : output.source);
      }
      const version = hash.digest("hex").slice(0, 12);
      const urls = files.map((file) => `${base}${file}`);
      const prefix = `idea-stream-shell-${createHash("sha256").update(base).digest("hex").slice(0, 8)}-`;
      this.emitFile({
        type: "asset",
        fileName: "recorder-sw.js",
        source: `
const CACHE_PREFIX = ${JSON.stringify(prefix)};
const CACHE = CACHE_PREFIX + ${JSON.stringify(version)};
const ASSETS = ${JSON.stringify(urls)};
const SHELL = ${JSON.stringify(`${base}index.html`)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' }))))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || (url.pathname.startsWith('/api/') || url.pathname.startsWith(${JSON.stringify(`${base}api/`)}))) return;
  if (event.request.mode === 'navigate' && url.pathname.startsWith(${JSON.stringify(base)})) {
    event.respondWith(fetch(event.request).catch(() => caches.open(CACHE).then(cache => cache.match(SHELL))));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(event.request)) || fetch(event.request)));
  }
});
// Reminders (meetings, events, tasks) arrive as push notifications; tapping one opens its page.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = { title: event.data ? event.data.text() : 'Idea Stream' }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Idea Stream', {
    body: data.body || '', tag: data.tag, renotify: true, requireInteraction: true, vibrate: [300, 120, 300, 120, 300],
    icon: ${JSON.stringify(`${base}icon-192.png`)}, badge: ${JSON.stringify(`${base}icon-192.png`)}, data: { url: data.url || ${JSON.stringify(base)} },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || ${JSON.stringify(base)}, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    for (const client of windows) if (client.url.startsWith(self.location.origin) && 'focus' in client) { client.navigate(target); return client.focus(); }
    return self.clients.openWindow(target);
  }));
});
`,
      });
    },
  };
}
