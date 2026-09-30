/* Keeps the Aggregate Planner usable offline once it has loaded. Network first, so a visit
 * online always gets the current files; the copy saved here is only used when the network
 * fails. Scope is /aggregate-planning/, but it also keeps the site stylesheet and fonts the
 * page needs. Bump VERSION to drop old copies.
 */
const VERSION = "ap-v3";
const CORE = [
  "/aggregate-planning/", "/aggregate-planning/planner.css", "/aggregate-planning/app.js", "/aggregate-planning/model.js", "/aggregate-planning/xlsx.js", "/aggregate-planning/study.js",
  "/aggregate-planning/solver.js", "/aggregate-planning/solver-worker.js", "/aggregate-planning/lib/highs.js",
  "/aggregate-planning/lib/highs.wasm", "/aggregate-planning/lib/chart.umd.min.js", "/assets/css/style.css",
  "/assets/fonts/inter.woff2", "/assets/fonts/cormorant-garamond.woff2", "/assets/fonts/ibm-plex-mono-400.woff2",
  "/assets/fonts/ibm-plex-mono-500.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("ap-") && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || Response.error())));
});
