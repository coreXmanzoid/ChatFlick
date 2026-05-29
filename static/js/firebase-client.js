const firebaseRuntimeConfig = window.firebaseRuntimeConfig || {};
const firebaseEnabled = Boolean(firebaseRuntimeConfig.firebaseEnabled);
const vapidKey = firebaseRuntimeConfig.vapidKey || "";
const firebaseMessagingSwPath = "/service-worker.js";
const firebaseConfig = firebaseRuntimeConfig.firebaseConfig || {};
const firebaseTokenStorageKey = "chatflick:fcm-token";

let messaging = null;
let firebaseMessagingRegistrationPromise = null;
let firebaseMessagingReadyPromise = null;

function isIosDevice() {
    return (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    );
}

function isStandaloneDisplayMode() {
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        window.navigator.standalone === true
    );
}

function isEdgeBrowser() {
    return /Edg\//.test(navigator.userAgent);
}

function getPushSupportIssue() {
    if (!window.isSecureContext) {
        return "Push notifications require HTTPS or localhost.";
    }

    if (!("serviceWorker" in navigator)) {
        return "Service workers are not supported in this browser.";
    }

    if (!("Notification" in window)) {
        return "Notifications are not supported in this browser.";
    }

    if (!("PushManager" in window)) {
        return "Push messaging is not supported in this browser.";
    }

    if (isIosDevice() && !isStandaloneDisplayMode()) {
        return (
            "On iPhone and iPad, install ChatFlick to your Home Screen first, then open it and enable notifications."
        );
    }

    return "";
}

function getNotificationPayload(payload) {
    const notification = payload && payload.notification ? payload.notification : {};
    const data = payload && payload.data ? payload.data : {};

    return {
        title: notification.title || data.title || "ChatFlick",
        body: notification.body || data.body || "",
        icon: notification.icon || data.icon || "/static/icons/icon-192.png",
        data: data
    };
}

function waitForServiceWorkerActivation(registration) {
    if (registration.active) {
        return Promise.resolve(registration);
    }

    const installingWorker = registration.installing || registration.waiting;
    if (!installingWorker) {
        return navigator.serviceWorker.ready.then(function () {
            return registration;
        });
    }

    return new Promise(function (resolve) {
        function onStateChange() {
            if (installingWorker.state === "activated") {
                installingWorker.removeEventListener("statechange", onStateChange);
                resolve(registration);
            }
        }

        installingWorker.addEventListener("statechange", onStateChange);
        if (installingWorker.state === "activated") {
            onStateChange();
        }
    });
}

async function clearStalePushSubscription(registration) {
    if (!registration || !registration.pushManager) {
        return;
    }

    try {
        const existingSubscription = await registration.pushManager.getSubscription();
        if (existingSubscription) {
            await existingSubscription.unsubscribe();
        }
    } catch (error) {
        console.warn("Could not clear stale push subscription:", error);
    }
}

function isFirebaseMessagingServiceWorker(scriptUrl) {
    if (!scriptUrl) {
        return false;
    }

    try {
        const url = new URL(scriptUrl, window.location.origin);
        return url.pathname === firebaseMessagingSwPath || url.pathname === "/firebase-messaging-sw.js";
    } catch (error) {
        return scriptUrl.indexOf("service-worker.js") !== -1 || scriptUrl.indexOf("firebase-messaging-sw.js") !== -1;
    }
}

async function cleanupConflictingServiceWorkers() {
    if (!("serviceWorker" in navigator)) {
        return;
    }

    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
        registrations.map(async function (registration) {
            const scriptUrl =
                (registration.active && registration.active.scriptURL) ||
                (registration.installing && registration.installing.scriptURL) ||
                (registration.waiting && registration.waiting.scriptURL) ||
                "";

            if (!isFirebaseMessagingServiceWorker(scriptUrl)) {
                try {
                    await registration.unregister();
                } catch (error) {
                    console.warn("Could not unregister conflicting service worker:", error);
                }
            }
        })
    );
}

function getFirebaseMessagingRegistration() {
    if (!firebaseMessagingRegistrationPromise) {
        firebaseMessagingRegistrationPromise = cleanupConflictingServiceWorkers()
            .then(function () {
                return navigator.serviceWorker.register(firebaseMessagingSwPath, {
                    scope: "/",
                    updateViaCache: "none"
                });
            })
            .then(function (registration) {
                return waitForServiceWorkerActivation(registration);
            })
            .then(function (registration) {
                return navigator.serviceWorker.ready.then(function () {
                    return registration;
                });
            })
            .catch(function (error) {
                firebaseMessagingRegistrationPromise = null;
                throw error;
            });
    }

    return firebaseMessagingRegistrationPromise;
}

function hasCompleteFirebaseConfig() {
    return ["apiKey", "authDomain", "projectId", "messagingSenderId", "appId"].every(function (key) {
        return Boolean(firebaseConfig[key]);
    });
}

async function isFirebaseMessagingSupported() {
    if (getPushSupportIssue()) {
        return false;
    }

    if (!window.firebase || !window.firebase.messaging) {
        return false;
    }

    if (typeof firebase.messaging.isSupported !== "function") {
        return true;
    }

    return await firebase.messaging.isSupported();
}

async function initializeFirebaseMessaging() {
    if (firebaseMessagingReadyPromise) {
        return firebaseMessagingReadyPromise;
    }

    firebaseMessagingReadyPromise = (async function () {
        if (!firebaseEnabled) {
            return null;
        }

        if (!hasCompleteFirebaseConfig()) {
            console.warn("Firebase web config is incomplete.");
            return null;
        }

        if (!(await isFirebaseMessagingSupported())) {
            console.warn("Firebase Messaging is not supported in this browser.");
            return null;
        }

        try {
            if (!firebase.apps.length) {
                firebase.initializeApp(firebaseConfig);
            }

            messaging = firebase.messaging();
            messaging.onMessage(showForegroundNotification);
            return messaging;
        } catch (error) {
            console.error("Firebase Messaging failed to initialize:", error);
            messaging = null;
            return null;
        }
    })();

    return firebaseMessagingReadyPromise;
}

async function requestFcmToken(activeMessaging, registration, retryAfterReset) {
    try {
        return await activeMessaging.getToken({
            vapidKey: vapidKey,
            serviceWorkerRegistration: registration
        });
    } catch (error) {
        const shouldRetry =
            !retryAfterReset &&
            isEdgeBrowser() &&
            error &&
            String(error.message || error).toLowerCase().indexOf("push service error") !== -1;

        if (!shouldRetry) {
            throw error;
        }

        await clearStalePushSubscription(registration);

        try {
            if (typeof activeMessaging.deleteToken === "function") {
                await activeMessaging.deleteToken();
            }
        } catch (deleteError) {
            console.warn("Could not delete previous Firebase token before retry:", deleteError);
        }

        return requestFcmToken(activeMessaging, registration, true);
    }
}

async function showForegroundNotification(payload) {
    if (!("Notification" in window) || Notification.permission !== "granted") {
        return;
    }

    const notification = getNotificationPayload(payload);

    try {
        if ("serviceWorker" in navigator) {
            const registration = await getFirebaseMessagingRegistration();
            await registration.showNotification(notification.title, {
                body: notification.body,
                icon: notification.icon,
                data: notification.data,
                badge: "/static/assets/logo.png"
            });
            return;
        }

        if (typeof Notification === "function") {
            new Notification(notification.title, {
                body: notification.body,
                icon: notification.icon,
                data: notification.data
            });
        }
    } catch (error) {
        console.error("Unable to show foreground notification:", error);
    }
}

async function enableNotifications(allowPermissionPrompt) {
    try {
        const supportIssue = getPushSupportIssue();
        if (supportIssue) {
            if (allowPermissionPrompt) alert(supportIssue);
            return;
        }

        if (!firebaseEnabled) {
            if (allowPermissionPrompt) alert("Push notifications are not available right now.");
            return;
        }

        if (!vapidKey) {
            if (allowPermissionPrompt) alert("FCM_VAPID_KEY is not configured on the server.");
            return;
        }

        const activeMessaging = await initializeFirebaseMessaging();
        if (!activeMessaging) {
            if (allowPermissionPrompt) {
                alert(
                    getPushSupportIssue() ||
                        "Firebase Messaging is not available in this browser."
                );
            }
            return;
        }

        const registration = await getFirebaseMessagingRegistration();
        let permission = Notification.permission;
        if (permission !== "granted" && allowPermissionPrompt) {
            permission = await Notification.requestPermission();
        }

        if (permission !== "granted") {
            if (allowPermissionPrompt) alert("Permission denied");
            return;
        }

        const token = await requestFcmToken(activeMessaging, registration, false);

        if (!token) {
            if (allowPermissionPrompt) alert("Could not get FCM token.");
            return;
        }

        const response = await fetch("/save-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ token: token })
        });

        if (!response.ok) {
            let message = "Failed to save notification token.";
            try {
                const errorResult = await response.json();
                if (errorResult && errorResult.message) message = errorResult.message;
            } catch (parseError) {
                // Ignore non-JSON errors.
            }
            if (allowPermissionPrompt) alert(message);
            return;
        }

        const result = await response.json();
        if (result.status !== "saved") {
            if (allowPermissionPrompt) alert("Failed to save notification token.");
            return;
        }

        if (allowPermissionPrompt) {
            if (isEdgeBrowser()) {
                alert(
                    "Notifications enabled. If Edge still does not show alerts, check Windows Settings > System > Notifications and allow Microsoft Edge."
                );
            } else {
                alert("Notifications enabled");
            }
        }

        try {
            window.localStorage.setItem(firebaseTokenStorageKey, token);
        } catch (storageError) {
            console.warn("Could not persist FCM token locally:", storageError);
        }

        $("#notifications-permission").remove();
        $(".notifications").show();
    } catch (error) {
        console.error("Push notification setup failed:", error);
        if (allowPermissionPrompt) {
            const errorMessage = String((error && error.message) || error || "");
            if (errorMessage.toLowerCase().indexOf("push service error") !== -1 && isEdgeBrowser()) {
                alert(
                    "Edge could not register for push notifications. Allow notifications for this site and for Microsoft Edge in Windows Settings, then try again."
                );
            } else {
                alert("Unable to enable push notifications right now.");
            }
        }
    }
}

function requestNotificationPermission() {
    return enableNotifications(true);
}

async function deleteSavedNotificationToken() {
    let token = "";
    try {
        token = window.localStorage.getItem(firebaseTokenStorageKey) || "";
    } catch (storageError) {
        token = "";
    }

    try {
        const activeMessaging = await initializeFirebaseMessaging();
        if (activeMessaging) {
            if (typeof activeMessaging.deleteToken === "function") {
                await activeMessaging.deleteToken();
            }
        }

        if ("serviceWorker" in navigator) {
            const registration = await getFirebaseMessagingRegistration();
            await clearStalePushSubscription(registration);
        }
    } catch (error) {
        console.warn("Unable to delete Firebase token in browser:", error);
    }

    try {
        await fetch("/delete-token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ token: token })
        });
    } catch (error) {
        console.warn("Unable to clear notification token on server:", error);
    }

    try {
        window.localStorage.removeItem(firebaseTokenStorageKey);
    } catch (storageError) {
        // Ignore storage cleanup failures.
    }
}

document.addEventListener("click", function (event) {
    if (event.target && event.target.closest(".notifications-allow")) {
        event.preventDefault();
        enableNotifications(true);
    }

    const logoutLink = event.target && event.target.closest("a[href*='/logout/']");
    if (logoutLink) {
        event.preventDefault();
        const href = logoutLink.href;
        deleteSavedNotificationToken().finally(function () {
            window.location.href = href;
        });
    }
});

document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") {
        return;
    }

    if (!("Notification" in window) || Notification.permission !== "granted") {
        return;
    }

    enableNotifications(false);
});

initializeFirebaseMessaging().then(function () {
    if ("Notification" in window && Notification.permission === "granted" && !getPushSupportIssue()) {
        enableNotifications(false);
    }
});

window.enableNotifications = enableNotifications;
window.requestNotificationPermission = requestNotificationPermission;
window.deleteSavedNotificationToken = deleteSavedNotificationToken;
window.getPushSupportIssue = getPushSupportIssue;
