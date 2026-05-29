// ChatFlick PWA boot file.
// Update app version by changing CACHE_VERSION in static/pwa/service-worker.js.
// Clear stale caches by bumping that version; the activate event removes old caches.
(function () {
    const splashMinTime = 650;
    const startedAt = Date.now();
    let deferredInstallPrompt = null;

    function hideSplash() {
        const splash = document.querySelector("[data-chatflick-splash]");
        if (!splash) return;

        const wait = Math.max(0, splashMinTime - (Date.now() - startedAt));
        window.setTimeout(function () {
            splash.classList.add("is-hidden");
            window.setTimeout(function () {
                if (splash && splash.parentNode) splash.parentNode.removeChild(splash);
            }, 520);
        }, wait);
    }

    function registerServiceWorker() {
        if (!("serviceWorker" in navigator) || !window.isSecureContext) return;

        navigator.serviceWorker.register("/service-worker.js", {
            scope: "/",
            updateViaCache: "none"
        }).catch(function (error) {
            console.warn("ChatFlick PWA service worker registration failed:", error);
        });
    }

    window.addEventListener("beforeinstallprompt", function (event) {
        event.preventDefault();
        deferredInstallPrompt = event;
        window.dispatchEvent(new CustomEvent("chatflickinstallready"));
    });

    window.ChatFlickPWA = {
        promptInstall: function () {
            if (!deferredInstallPrompt) return Promise.resolve(false);
            deferredInstallPrompt.prompt();
            return deferredInstallPrompt.userChoice.finally(function () {
                deferredInstallPrompt = null;
            });
        }
    };

    if (document.readyState === "complete") {
        hideSplash();
        registerServiceWorker();
    } else {
        window.addEventListener("load", function () {
            hideSplash();
            registerServiceWorker();
        });
    }
})();
