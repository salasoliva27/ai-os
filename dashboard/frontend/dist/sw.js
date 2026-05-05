// Minimal service worker — exists so browsers recognize the app as a PWA
// and offer "Install" / "Add to Home Screen" prompts.
//
// Deliberately NOT a caching SW: this app is bridge-driven (WebSockets +
// API), and stale cached HTML/JS would break it in subtle ways. The fetch
// handler just passes through.
//
// If we ever want offline support (e.g. show "bridge unreachable, retry?"
// when the connection drops mid-trip), add it here.

const VERSION = "janus-pwa-v2";

self.addEventListener("install", (event) => {
  // Activate immediately on first install rather than waiting for all tabs to
  // close (which would defeat the point on a single-app PWA).
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of any already-open clients without requiring a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  // Pass-through. The browser handles everything; we just need to be
  // listening so the PWA install criteria are satisfied.
  // (Some browsers — notably Chrome on Android — require an installed SW
  // with at least one fetch listener before showing the install prompt.)
  return;
});
