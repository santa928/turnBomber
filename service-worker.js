const CACHE_NAME = "turn-bomber-cache-v2";

const APP_SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./service-worker.js",
  "./src/app.js",
  "./src/core/index.js",
  "./src/core/constants.js",
  "./src/core/createInitialState.js",
  "./src/core/reducer.js",
  "./src/ui/pixiBoard.js",
  "./src/ui/styles.css",
  "./icons/apple-touch-icon.png",
  "./icons/favicon-16.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg"
];

const THIRD_PARTY_ASSETS = [
  "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.mjs"
];

async function cacheExternalAssets(cache, urls) {
  await Promise.all(
    urls.map(async (url) => {
      try {
        const response = await fetch(new Request(url, { mode: "no-cors" }));
        await cache.put(url, response);
      } catch {
        // Cross-origin asset caching is best-effort.
      }
    })
  );
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request, { ignoreSearch: true });
  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (networkResponse.ok || networkResponse.type === "opaque") {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}

async function navigationRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      cache.put("./index.html", networkResponse.clone());
    }
    return networkResponse;
  } catch {
    const cachedPage = await cache.match(request);
    if (cachedPage) {
      return cachedPage;
    }
    const appShell = await cache.match("./index.html");
    if (appShell) {
      return appShell;
    }
    return new Response("Offline", { status: 503 });
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL_ASSETS);
      await cacheExternalAssets(cache, THIRD_PARTY_ASSETS);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(navigationRequest(request));
    return;
  }

  event.respondWith(
    cacheFirst(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(request, { ignoreSearch: true });
      if (cachedResponse) {
        return cachedResponse;
      }
      return new Response("Offline", { status: 503 });
    })
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
