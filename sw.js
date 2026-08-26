/* Meta-Stripper by Uli
   App-shell Service Worker. User images are never cached. */

"use strict";

const CACHE_NAME = "meta-stripper-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./batch.css",
  "./config.js",
  "./app.js",
  "./manifest.webmanifest",
  "./assets/icon.svg",
];

async function networkFirst(request, fallbackKey) {
  try {
    const response = await fetch(request);

    if (response.ok && response.type === "basic") {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(fallbackKey || request, response.clone());
    }

    return response;
  } catch {
    return caches.match(fallbackKey || request);
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((cacheName) => cacheName.startsWith("meta-stripper-") && cacheName !== CACHE_NAME)
        .map((cacheName) => caches.delete(cacheName))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, "./index.html"));
    return;
  }

  if (requestUrl.pathname.endsWith("/config.js")) {
    event.respondWith(networkFirst(request, request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(request).then(async (response) => {
        if (response.ok && response.type === "basic") {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      });
    })
  );
});
