// ChatFlick PWA service worker.
// Files are stored in static/pwa/. Bump CACHE_VERSION when app assets change.
// To clear old caches during updates, increment CACHE_VERSION and reload clients.
const CACHE_VERSION = "2026-05-29-4";
const STATIC_CACHE = `chatflick-static-${CACHE_VERSION}`;
const RUNTIME_CACHE = `chatflick-runtime-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline";

const FIREBASE_CONFIG = {};
// __CHATFLICK_FIREBASE_CONFIG_INJECTION__

const APP_SHELL_ASSETS = [
    "/",
    OFFLINE_URL,
    "/manifest.json",
    "/static/icons/icon-192.png",
    "/static/icons/icon-512.png",
    "/static/icons/favicon.ico",
    "/static/assets/Logo_icon.png",
    "/static/assets/Logo_horizontal.png",
    "/static/css/styles.css",
    "/static/css/styles01.css",
    "/static/css/mobile.css",
    "/static/pwa/pwa.css",
    "/static/pwa/pwa.js",
    "/static/js/home.js",
    "/static/js/mobile-home.js",
    "/static/js/firebase-client.js"
];

function hasFirebaseConfig(config) {
    return ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"].every(
        (key) => Boolean(config && config[key])
    );
}

try {
    if (hasFirebaseConfig(FIREBASE_CONFIG)) {
        importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js");
        importScripts("https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js");

        if (self.firebase && !firebase.apps.length) {
            firebase.initializeApp(FIREBASE_CONFIG);
        }

        if (self.firebase && firebase.messaging) {
            const messaging = firebase.messaging();
            messaging.onBackgroundMessage((payload) => {
                if (payload && payload.notification) return;

                const notification = payload && payload.notification ? payload.notification : {};
                const data = payload && payload.data ? payload.data : {};
                const title = notification.title || data.title || "ChatFlick";
                const tag = data.type ? `${data.type}_${data.identifier || ""}` : "chatflick_general";

                self.registration.showNotification(title, {
                    body: notification.body || data.body || "",
                    icon: notification.icon || data.icon || "/static/icons/icon-192.png",
                    badge: "/static/icons/icon-192.png",
                    data,
                    tag,
                    renotify: true
                });
            });
        }
    }
} catch (error) {
    console.warn("Firebase messaging is unavailable in the PWA worker.", error);
}

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL_ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key.startsWith("chatflick-") && ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const request = event.request;
    if (request.method !== "GET") return;

    const requestUrl = new URL(request.url);
    if (requestUrl.origin !== self.location.origin) {
        event.respondWith(
            caches.match(request).then((cached) => cached || fetch(request).catch(() => cached))
        );
        return;
    }

    if (request.mode === "navigate") {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
                    return response;
                })
                .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_URL)))
        );
        return;
    }

    if (request.destination === "style" || request.destination === "script" || request.destination === "image" || requestUrl.pathname.startsWith("/static/")) {
        event.respondWith(
            caches.match(request).then((cached) => {
                const fetchAndCache = fetch(request).then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy));
                    }
                    return response;
                });
                return cached || fetchAndCache;
            })
        );
    }
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const targetUrl = event.notification.data && event.notification.data.url
        ? event.notification.data.url
        : "/home";
    const absoluteTargetUrl = new URL(targetUrl, self.location.origin).href;

    event.waitUntil(
        clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url === absoluteTargetUrl && "focus" in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
            return null;
        })
    );
});
