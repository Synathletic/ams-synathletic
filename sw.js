// Service worker AMS Syn'Athlétic : met en cache l'interface (pas les données de santé).
// Les appels à Supabase ne sont JAMAIS mis en cache.
// Changer le numéro de version ci-dessous à chaque mise à jour de l'application.
const VERSION = "ams-v4-1";
const FICHIERS = [
  "./", "index.html", "style.css", "config.js", "app.js",
  "logo.png", "icon-192.png", "manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Données et authentification : toujours le réseau, jamais le cache
  if (url.hostname.endsWith("supabase.co")) return;
  // Bibliothèque Supabase (CDN) : réseau d'abord, copie locale en secours
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      fetch(req).then((r) => { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); return r; })
        .catch(() => caches.match(req))
    );
    return;
  }
  // Fichiers de l'application : réseau d'abord, cache si hors ligne
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req).then((r) => { const copie = r.clone(); caches.open(VERSION).then((c) => c.put(req, copie)); return r; })
        .catch(() => caches.match(req).then((r) => r || caches.match("index.html")))
    );
  }
});
