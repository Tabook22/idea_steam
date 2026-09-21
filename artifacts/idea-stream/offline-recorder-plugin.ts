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
        /\.(?:js|css|html)$/.test(file),
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
`,
      });
    },
  };
}
