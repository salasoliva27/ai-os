// Minimal service worker — exists so browsers recognize the app as a PWA
// and offer "Install" / "Add to Home Screen" prompts.
//
// Pass-through only — no caching. The app is bridge-driven (WS + API) and
// stale cache would break it. Add caching here if/when offline support is
// wanted.

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through. Listening so install criteria are satisfied.
  return;
});
