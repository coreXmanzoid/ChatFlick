const controllers = {};
const FEED_PER_PAGE = 10;
const feedState = {
    state: 0,
    id: 0,
    loading: false,
    hasMore: true,
    active: false
};

function getToastMeta(type) {
    switch (type) {
        case "success":
            return { icon: "+", title: "Success" };
        case "error":
            return { icon: "!", title: "Something went wrong" };
        case "info":
            return { icon: "i", title: "Notice" };
        default:
            return { icon: "*", title: "Update" };
    }
}

function showSettingToast(message, type = "info") {
    const toastStack = document.getElementById("settingsToastStack");
    if (!toastStack || !message) {
        return;
    }

    const normalizedType = ["success", "error", "info"].includes(type) ? type : "info";
    const meta = getToastMeta(normalizedType);
    const toast = document.createElement("article");
    toast.className = `settings-toast settings-toast--${normalizedType}`;
    toast.setAttribute("role", normalizedType === "error" ? "alert" : "status");

    toast.innerHTML = `
        <div class="settings-toast-icon" aria-hidden="true">${meta.icon}</div>
        <div class="settings-toast-body">
            <h3 class="settings-toast-title">${meta.title}</h3>
            <p class="settings-toast-message"></p>
        </div>
        <button class="settings-toast-close" type="button" aria-label="Close notification">&times;</button>
    `;

    toast.querySelector(".settings-toast-message").textContent = message;

    const removeToast = () => {
        if (toast.classList.contains("is-removing")) {
            return;
        }

        toast.classList.add("is-removing");
        window.setTimeout(() => toast.remove(), 250);
    };

    toast.querySelector(".settings-toast-close").addEventListener("click", removeToast);
    toastStack.appendChild(toast);
    window.setTimeout(removeToast, 4200);
}

function abortAndRenew(key) {
    if (controllers[key]) {
        controllers[key].abort();
    }

    controllers[key] = new AbortController();
    return controllers[key];
}

function ajaxWithAbort(key, options) {
    const controller = abortAndRenew(key);
    const signal = controller.signal;
    const callerXhr = options.xhr;

    return $.ajax($.extend({}, options, {
        headers: $.extend({
            "X-ChatFlick-SPA": "1"
        }, options.headers || {}),
        xhr: function () {
            const xhr = callerXhr ? callerXhr() : $.ajaxSettings.xhr();
            signal.addEventListener("abort", function () {
                xhr.abort();
            });
            return xhr;
        },
        error: function (jqXHR, textStatus, errorThrown) {
            if (textStatus === "abort") {
                return;
            }

            if (typeof options.error === "function") {
                options.error(jqXHR, textStatus, errorThrown);
                return;
            }

            console.error("Ajax error [" + key + "]:", textStatus, errorThrown);
        }
    }));
}

function getCurrentUserId() {
    const className = $(".div1").attr("class") || "";
    return parseInt(className.split(" ")[1], 10);
}

function getTextNode($element) {
    let textNode = $element.contents().filter(function () {
        return this.nodeType === 3;
    }).first();

    if (!textNode.length) {
        $element.append(" 0");
        textNode = $element.contents().filter(function () {
            return this.nodeType === 3;
        }).first();
    }

    return textNode;
}

function setActionCount($element, count) {
    const $count = $element.find("span").first();

    if ($count.length) {
        $count.text(count);
        return;
    }

    const textNode = getTextNode($element);
    textNode[0].nodeValue = " " + count;
}

function getShareContext($btn) {
    const $container = $btn.closest(".post, .post-detail");
    const rawPostId = $container.data("postid");
    const postId = typeof rawPostId === "string" ? rawPostId.trim() : rawPostId;
    const text = $container.find(".post-content .content").first().text().trim();

    return {
        $container: $container,
        postId: postId,
        text: text
    };
}

function getPostPermalink(postId) {
    return new URL("/post/" + postId, window.location.origin).href;
}

async function sharePostContent(shareData) {
    if (navigator.share) {
        await navigator.share(shareData);
        return {
            shared: true,
            mode: "native"
        };
    }

    if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareData.url);
        return {
            shared: true,
            mode: "clipboard"
        };
    }

    const fallbackInput = document.createElement("textarea");
    fallbackInput.value = shareData.url;
    fallbackInput.setAttribute("readonly", "");
    fallbackInput.style.position = "fixed";
    fallbackInput.style.opacity = "0";
    document.body.appendChild(fallbackInput);
    fallbackInput.focus();
    fallbackInput.select();

    try {
        const copied = document.execCommand("copy");
        if (!copied) {
            throw new Error("Copy command failed");
        }

        return {
            shared: true,
            mode: "clipboard"
        };
    } finally {
        document.body.removeChild(fallbackInput);
    }
}

function parseUtcTimestamp(timestamp) {
    if (!timestamp) {
        return null;
    }

    const value = String(timestamp);
    // Legacy rows may render without an offset; append UTC so browsers do not parse as local time.
    const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : value + "Z";
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatLocalTimestamp(timestamp) {
    const date = parseUtcTimestamp(timestamp);
    return date ? date.toLocaleString() : "";
}

function formatRelativeTime(timestamp) {
    const date = parseUtcTimestamp(timestamp);
    if (!date) {
        return "";
    }

    const diffMs = new Date() - date;
    const diffMins = Math.max(0, Math.floor(diffMs / 60000));

    if (diffMins >= 43200) {
        return formatLocalTimestamp(timestamp);
    }

    if (diffMins < 1) {
        return "Just now";
    }
    if (diffMins < 60) {
        return diffMins === 1 ? "1m ago" : diffMins + " m ago";
    }
    if (diffMins < 1440) {
        const hours = Math.floor(diffMins / 60);
        return hours === 1 ? "1h ago" : hours + "h ago";
    }
    if (diffMins < 10080) {
        const days = Math.floor(diffMins / 1440);
        return days === 1 ? "1d ago" : days + "d ago";
    }
    const weeks = Math.floor(diffMins / 10080);
    return weeks === 1 ? "1w ago" : weeks + "w ago";
}

function formatCompactRelativeTime(timestamp) {
    const date = parseUtcTimestamp(timestamp);
    if (!date) {
        return "";
    }

    const diffMs = new Date() - date;
    const diffMins = Math.max(0, Math.floor(diffMs / 60000));

    if (diffMins < 1) {
        return "0s";
    }
    if (diffMins < 60) {
        return diffMins + "m";
    }
    if (diffMins < 1440) {
        return Math.floor(diffMins / 60) + "h";
    }
    if (diffMins < 10080) {
        return Math.floor(diffMins / 1440) + "d";
    }
    if (diffMins < 43200) {
        return Math.floor(diffMins / 10080) + "w";
    }

    return formatLocalTimestamp(timestamp);
}

function parseMentions(value) {
    if (!value) {
        return [];
    }

    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}

function renderMentions(selector) {
    document.querySelectorAll(selector).forEach(function (el) {
        const mentions = parseMentions(el.dataset.mentions);
        let text = el.innerText;

        mentions.forEach(function (mention) {
            const username = mention.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const regex = new RegExp("@" + username + "\\b", "g");
            text = text.replace(regex, '<span onclick="ChatFlickNav.navigate(\'/profile/' + mention.user_id + '\')" class="mention" style="cursor: pointer;" title="View profile">@' + mention.username + "</span>");
        });

        el.innerHTML = text;
    });
}

function renderHashtags(selector) {
    document.querySelectorAll(selector).forEach(function (el) {
        const tags = (el.textContent.match(/#[^\s#]+/g) || []);

        el.innerHTML = "";

        tags.forEach(function (tag, index) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "hashtag-link";
            button.dataset.hashtag = tag;
            button.textContent = tag;

            if (index > 0) {
                el.appendChild(document.createTextNode(" "));
            }

            el.appendChild(button);
        });
    });
}

function initializeComposerFragment($root) {
    const $textareas = $root.find("textarea[name='post-input']");
    if (!$textareas.length) {
        return;
    }

    $textareas.each(function () {
        updateComposerState($(this));
    });
}

function initializeProfileFragment($root) {
    if (!$root.find(".profile").length) {
        return;
    }

    const $birthDate = $root.find("#birthDate");
    const rawDate = $.trim($birthDate.text());
    if (rawDate) {
        const dateObj = new Date(rawDate);
        if (!Number.isNaN(dateObj.getTime())) {
            const formatted = String(dateObj.getDate()).padStart(2, "0") + " " +
                dateObj.toLocaleString("en-GB", { month: "short" }) + ", " +
                dateObj.getFullYear();
            $birthDate.text(formatted);
        }
    }

    $root.find(".ProfileOptions h6").removeClass("active-a").first().addClass("active-a");
}

function initializePostsFragment($root) {
    if (!$root.find(".post").length) {
        return;
    }

    renderMentions(".post-content .content");
    renderHashtags(".post-content .hashtag");

    $root.find(".post-time").each(function () {
        const display = formatRelativeTime($(this).data("timestamp"));
        if (display) {
            $(this).text(display);
        }
    });
}

function initializeCommentsFragment($root) {
    if (!$root.find(".all-comments, .post-detail").length) {
        return;
    }

    renderMentions(".comment-content .content");
}

function initializeNotificationsFragment($root) {
    if (!$root.find(".notifications, #notifications-permission").length) {
        return;
    }

    initializeOptionsToggle($root);

    const permissionWarning = document.getElementById("notifications-permission");
    if (permissionWarning) {
        const pushIssue = typeof window.getPushSupportIssue === "function" ? window.getPushSupportIssue() : "";
        if (pushIssue) {
            const messageNode = permissionWarning.querySelector("p.text-muted");
            if (messageNode) {
                messageNode.textContent = pushIssue;
            }
        } else if ("Notification" in window && Notification.permission === "granted") {
            $("#notifications-permission").remove();
            if (typeof window.enableNotifications === "function") {
                window.enableNotifications(false);
            }
        }
        $(".notifications").show();
    }

    $root.find(".notification-message span").each(function () {
        const display = formatCompactRelativeTime($(this).data("timestamp"));
        if (display) {
            $(this).text(display);
        }
    });
}

function initializeDynamicContent($root) {
    initializeComposerFragment($root);
    initializeProfileFragment($root);
    initializePostsFragment($root);
    initializeCommentsFragment($root);
    initializeNotificationsFragment($root);
}

function injectHtmlResponse($target, response) {
    const dummy = $("<div>").html(response);
    const scripts = dummy.find("script");
    dummy.find("script").remove();
    $target.html(dummy.html());

    scripts.each(function () {
        const code = $(this).text();
        if (code.trim() !== "") {
            eval(code); // eslint-disable-line no-eval
        }
    });

    initializeDynamicContent($target);
}

function loadFragment(key, $target, url, loaderHtml) {
    $target.html(loaderHtml);

    return ajaxWithAbort(key, {
        url: url,
        method: "GET",
        success: function (response) {
            injectHtmlResponse($target, response);
        },
        error: function (jqXHR, textStatus) {
            if (textStatus === "abort") {
                return;
            }
            window.location.href = url;
        }
    });
}

function getLoadedPostIds($target) {
    return $target.find(".post").map(function () {
        const postId = $(this).data("postid");
        return /^\d+$/.test(String(postId)) ? postId : null;
    }).get();
}

function buildPostsUrl(state, id, append) {
    const params = new URLSearchParams({
        per_page: FEED_PER_PAGE
    });

    if (append) {
        params.set("append", "1");
        params.set("exclude_ids", getLoadedPostIds($(".div3")).join(","));
    }

    return "/showPosts/" + state + "/" + id + "?" + params.toString();
}

function appendHtmlResponse($target, response) {
    const dummy = $("<div>").html(response);
    dummy.find("script").remove();
    const $posts = dummy.find(".post");

    $target.append(dummy.html());
    initializeDynamicContent($target);

    return $posts.length;
}

function appendNextPosts() {
    if (!feedState.active || feedState.loading || !feedState.hasMore) {
        return;
    }

    feedState.loading = true;
    const $loader = $('<div class="loader-wrapper feed-more-loader"><span class="loader"></span></div>');
    $(".div3").append($loader);

    ajaxWithAbort("appendPosts", {
        url: buildPostsUrl(feedState.state, feedState.id, true),
        method: "GET",
        success: function (response) {
            $loader.remove();
            const newPostCount = appendHtmlResponse($(".div3"), response);
            feedState.hasMore = newPostCount >= FEED_PER_PAGE;
        },
        error: function (jqXHR, textStatus, errorThrown) {
            $loader.remove();
            if (textStatus !== "abort") {
                console.error("Ajax error [appendPosts]:", textStatus, errorThrown);
            }
        },
        complete: function () {
            feedState.loading = false;
        }
    });
}

function isNearFeedBottom() {
    const threshold = 500;
    const $feed = $(".div3");

    if ($feed.length && $feed[0].scrollHeight > $feed.innerHeight() + 20) {
        return $feed.scrollTop() + $feed.innerHeight() >= $feed[0].scrollHeight - threshold;
    }

    return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - threshold;
}

function maybeLoadMorePosts() {
    if (isNearFeedBottom()) {
        appendNextPosts();
    }
}

function updateComposerState($textarea) {
    const inputLength = $textarea.val().length;
    const maxLength = Number($textarea.attr("maxlength")) || 180;
    const progress = (inputLength / maxLength) * 100;
    const circumference = 2 * Math.PI * 22;
    const offset = (progress / 100) * circumference;
    const $container = $textarea.closest(".div2, .container, body");

    $container.find(".progress-circle-indicator").css("stroke-dashoffset", offset);

    if (progress >= 100) {
        $container.find(".progress-circle-indicator").attr("stroke", "red");
    } else if (progress >= 80) {
        $container.find(".progress-circle-indicator").attr("stroke", "orange");
    } else {
        $container.find(".progress-circle-indicator").attr("stroke", "#3b82f6");
    }

    $container.find(".submit button").prop("disabled", !(inputLength > 0 && inputLength <= maxLength));
}

function validatePostFeatures(content, mentionsData) {

    // Detect mentions like @coreXmanzoid
    const mentionMatches = content.match(/@\w+/g) || [];

    // Detect hashtags like #ChatFlick
    const hashtagMatches = content.match(/#\w+/g) || [];

    // Check hashtag limit
    if (hashtagMatches.length > 5) {

        showSettingToast(
            "Free users can only use up to 5 hashtags per post.",
            "Notice"
        );

        return false;
    }

    // Check plain text mentions for free users
    if (mentionMatches.length > 0 && (!mentionsData || mentionsData.length === 0)) {

        showSettingToast(
            "Upgrade to ChatFlick Pro to use mentions in posts.",
            "Notice"
        );

        return false;
    }

    return true;
}

function exploreAccounts(url) {
    $(".explore-accounts").html('<div class="loader-wrapper"><span class="loader"></span></div>');

    ajaxWithAbort("exploreAccounts", {
        url: url,
        method: "GET",
        success: function (response) {
            injectHtmlResponse($(".explore-accounts"), response);
        }
    });
}

function showPosts(state, id) {
    if (controllers.appendPosts) {
        controllers.appendPosts.abort();
    }

    feedState.state = state;
    feedState.id = id;
    feedState.loading = true;
    feedState.hasMore = true;
    feedState.active = true;

    loadFragment(
        "showPosts",
        $(".div3"),
        buildPostsUrl(state, id, false),
        '<div class="page-loader page-loader--posts"><span class="loader1"></span></div>'
    ).done(function () {
        feedState.hasMore = $(".div3 .post").length >= FEED_PER_PAGE;
    }).always(function () {
        feedState.loading = false;
        maybeLoadMorePosts();
    });
}

function markAsRead() {
    const userId = $(".notifications").data("userid");

    if (!userId) {
        return;
    }

    ajaxWithAbort("markAsRead", {
        url: "/notifications/mark_read/" + userId,
        success: function () {
            checkForNotifications(getCurrentUserId());
            $(".notifications .badge").remove();
        },
        error: function (err) {
            console.error("Error marking notifications as read:", err);
        }
    });
}

const ChatFlickNav = (function () {
    const cache = new Map();
    const maxEntries = 8;
    let currentKey = null;
    let restoring = false;

    function keyFor(url) {
        const parsed = new URL(url, window.location.origin);
        return parsed.pathname + parsed.search;
    }

    function routeFor(url) {
        const parsed = new URL(url, window.location.origin);
        const path = parsed.pathname;
        const profileMatch = path.match(/^\/profile\/(\d+)$/);

        if (path === "/home" || path === "/mobile-home" || path === "/") {
            return { name: "home", url: "/home" };
        }
        if (profileMatch) {
            return { name: "profile", id: parseInt(profileMatch[1], 10), url: path };
        }
        if (path === "/notifications") {
            return { name: "notifications", url: path };
        }
        if (path === "/Manzoid-AI") {
            return { name: "ai", url: path };
        }
        if (path === "/liked") {
            return { name: "liked", url: path };
        }
        if (path === "/explore") {
            return { name: "explore", url: path };
        }
        const postMatch = path.match(/^\/post\/(\d+)$/);
        if (postMatch) {
            return { name: "post", id: parseInt(postMatch[1], 10), url: path };
        }

        return null;
    }

    function snapshot() {
        if (!currentKey || restoring) {
            return;
        }

        cache.set(currentKey, {
            div2: $(".div2").html(),
            div3: $(".div3").html(),
            div5: $(".parent > .div5").first().html(),
            fullPost: $(".full-post").html(),
            display: {
                div2: $(".div2").css("display"),
                fullPost: $(".full-post").css("display")
            },
            feedState: $.extend({}, feedState),
            scroll: {
                windowX: window.scrollX,
                windowY: window.scrollY,
                div3: $(".div3").scrollTop()
            }
        });

        while (cache.size > maxEntries) {
            cache.delete(cache.keys().next().value);
        }
    }

    function restore(key) {
        const entry = cache.get(key);
        if (!entry) {
            return false;
        }

        restoring = true;
        $(".div2").html(entry.div2).css("display", entry.display.div2 || "");
        $(".div3").html(entry.div3);
        $(".parent > .div5").first().html(entry.div5);
        $(".full-post").html(entry.fullPost).css("display", entry.display.fullPost || "");
        $.extend(feedState, entry.feedState || {});
        initializeDynamicContent($(".div2, .div3, .div5"));
        window.setTimeout(function () {
            $(".div3").scrollTop(entry.scroll.div3 || 0);
            window.scrollTo(entry.scroll.windowX || 0, entry.scroll.windowY || 0);
            restoring = false;
        }, 0);
        return true;
    }

    function setHistory(route, replace) {
        const state = { chatflick: true, url: route.url };
        if (replace) {
            window.history.replaceState(state, "", route.url);
        } else {
            window.history.pushState(state, "", route.url);
        }
    }

    function navigate(url, options) {
        const opts = options || {};
        const route = routeFor(url);

        if (!route) {
            window.location.href = url;
            return;
        }

        const nextKey = keyFor(route.url);
        snapshot();

        if (opts.fromPop && restore(nextKey)) {
            currentKey = nextKey;
            return;
        }

        renderRoute(route);
        currentKey = nextKey;

        if (!opts.fromPop) {
            setHistory(route, opts.replace);
        }
    }

    function start() {
        window.history.scrollRestoration = "manual";
        const route = routeFor(window.location.href) || { name: "home", url: "/home" };
        currentKey = keyFor(route.url);
        setHistory(route, true);
        renderRoute(route);

        window.addEventListener("popstate", function () {
            const route = routeFor(window.location.href);
            if (!route) {
                window.location.reload();
                return;
            }
            navigate(route.url, { fromPop: true });
        });
    }

    return {
        navigate: navigate,
        start: start
    };
})();
window.ChatFlickNav = ChatFlickNav;

function loadNotifications() {
    feedState.active = false;
    $(".full-post").hide();
    $(".notifications-tab").show().html('<div class="loader-wrapper"><span class="loader"></span></div>');
    $(".explore-tab").hide();
    $(".ai-bar").hide();

    ajaxWithAbort("loadNotifications", {
        url: "/notifications",
        method: "GET",
        success: function (response) {
            injectHtmlResponse($(".notifications-tab"), response);
            markAsRead();
        }
    });
}

function showAiView() {
    feedState.active = false;
    $(".full-post").hide();
    $(".div2").hide();
    loadFragment(
        "desktopAi",
        $(".div3"),
        "/Manzoid-AI",
        '<div class="loader-wrapper"><span class="loader"></span></div>'
    );
    $(".explore-tab").hide();
    $(".ai-bar").show();
    $(".notifications-tab").hide();
}

function showExploreView() {
    feedState.active = false;
    $(".full-post").hide();
    $(".ai-bar").hide();
    $(".explore-tab").show();
    $(".notifications-tab").hide();
    if (!$(".explore-tab .cf-explore").length) {
        loadFragment(
            "desktopExplore",
            $(".explore-tab"),
            "/explore",
            '<div class="loader-wrapper"><span class="loader"></span></div>'
        ).done(function () {
            $(".cf-search-input").trigger("focus");
        });
    } else {
        $(".cf-search-input").trigger("focus");
    }
}

function showLikedView() {
    const userId = getCurrentUserId();
    showPosts(3, userId);
    exploreAccounts("/exploreAccounts/0/random");
    $(".div2").hide();
    $(".full-post").hide();
    $(".ai-bar").hide();
    $(".explore-tab").show();
    $(".notifications-tab").hide();
}

function showProfile(userId) {
    loadFragment(
        "showProfile",
        $(".div2"),
        "/profile/" + userId,
        '<div class="page-loader page-loader--profile"><span class="loader2"></span></div>'
    );

    $(".full-post").hide();
    $(".ai-bar").hide();
    $(".explore-tab").show();
    $(".notifications-tab").hide();
    $(".div2").show();
    showPosts(1, userId);
    initializeOptionsToggle($(".div2"));
}

function Backtohome() {
    loadFragment(
        "backHomeProfile",
        $(".div2"),
        "/profile/0",
        '<div class="page-loader page-loader--profile"><span class="loader2"></span></div>'
    );
    $(".full-post").hide();
    $(".ai-bar").hide();
    $(".notifications-tab").hide();
    $(".explore-tab").show();
    if (!$(".explore-tab .cf-explore").length) {
        loadFragment(
            "desktopExplore",
            $(".explore-tab"),
            "/explore",
            '<div class="loader-wrapper"><span class="loader"></span></div>'
        );
    }
    $(".nav a").removeClass("active link-dark").addClass("link-dark");
    $(".home-link").addClass("active").removeClass("link-dark");
    $(".div2").show();
    showPosts(0, 0);
}

function renderRoute(route) {
    $(".nav a").removeClass("active link-dark").addClass("link-dark");

    if (route.name === "home") {
        $(".home-link").addClass("active").removeClass("link-dark");
        Backtohome();
        return;
    }

    if (route.name === "profile") {
        $(".profile-link").addClass("active").removeClass("link-dark");
        showProfile(route.id);
        return;
    }

    if (route.name === "notifications") {
        $(".notifications-button").addClass("active").removeClass("link-dark");
        loadNotifications();
        return;
    }

    if (route.name === "ai") {
        $(".ai-button").addClass("active").removeClass("link-dark");
        showAiView();
        return;
    }

    if (route.name === "liked") {
        $(".likes-button").addClass("active").removeClass("link-dark");
        showLikedView();
        return;
    }

    if (route.name === "explore") {
        $(".explore-button").addClass("active").removeClass("link-dark");
        showExploreView();
        return;
    }

    if (route.name === "post") {
        $(".home-link").addClass("active").removeClass("link-dark");
        Backtohome();
        openFullPostById(route.id);
    }
}

function openFullPostById(postId) {
    if (!postId || String(postId).indexOf("temp-") === 0) {
        return;
    }

    initializeOptionsToggle();

    $(".post").removeClass("active-post");
    $('.post[data-postid="' + postId + '"]').addClass("active-post");
    $(".explore-tab").hide();
    $(".ai-bar").hide();
    $(".full-post").css("display", "flex");
    $(".notifications-tab").hide();
    loadFragment(
        "showComments",
        $(".coreXmanzoid"),
        "/FullPost/" + postId,
        '<div class="loader-wrapper"><span class="loader"></span></div>'
    );
}

function showFullPost(e) {
    if (e) {
        e.preventDefault();
    }

    const $post = $(this).closest(".post");
    const postId = $post.length ? $post.data("postid") : $(".post.active-post").first().data("postid");

    if (!postId || String(postId).indexOf("temp-") === 0) {
        return;
    }

    ChatFlickNav.navigate("/post/" + postId);
}

function sendNotification({
    recipientId,
    title,
    identifier,
    message,
    type = "general",
    senderId,
    state,
    Push = "false"
}) {
    return $.ajax({
        url: "/send-notification-route/" + state + "/" + Push,
        type: "POST",
        data: JSON.stringify({
            recipient_id: recipientId,
            title: title,
            identifier: identifier,
            message: message,
            type: type,
            sender_id: senderId
        }),
        contentType: "application/json"
    });
}

function prependPost(content, userId) {
    const profileImg = $("#dropdownUser2 img").attr("src");
    const username = $("#dropdownUser2 strong").data("username");
    const name = $("#dropdownUser2 strong").text().trim();
    const tempId = "temp-" + Date.now();
    const timestamp = new Date().toISOString();
    const postHtml = `
        <div class="post info p-1" data-postid="${tempId}">
            <div class="post-heading">
                <img src="${profileImg}" alt="" width="40" height="40" class="rounded-circle me-2">
                <h5 class="${userId}">${name}<br><span>@${username}
                .<strong class="post-time" data-timestamp="${timestamp}">Just now</strong></span></h5>
                <div class="edit-post ms-auto me-2" title="Edit Post">
                    Posting...
                </div>
            </div>
            <div class="post-content">
                <p class="content" data-mentions='[]'></p>
                <p class="hashtag"></p>
            </div>
            <div class="post-actions">
                <a class="comment"><i class="bi bi-chat-heart"></i> 0</a>
                <a class="retweet"><i class="bi bi-repeat"></i> 0</a>
                <a class="like"><i class="bi bi-heart"></i> 0</a>
                <a class="share"><i class="bi bi-share"></i> 0</a>
            </div>
            <hr>
        </div>
    `;

    $(".div3").prepend(postHtml);
    $(".div3 .post").first().find(".post-content .content").text(content);
    initializePostsFragment($(".div3"));
    return tempId;
}

function uploadProfileImage(input, url) {
    const file = input.files[0];
    if (!file) {
        return;
    }

    const formData = new FormData();
    formData.append("profile", file);

    $.ajax({
        url: url,
        type: "POST",
        data: formData,
        contentType: false,
        processData: false,
        success: function (res) {
            if (res.image_url) {
                $(input).closest(".profile-pic-wrapper").find(".profile-pic").attr("src", res.image_url);
                $("#dropdownUser2 img").attr("src", res.image_url);
            }
        },
        error: function (err) {
            console.error(err.responseJSON || err);
        }
    });
}

function appendNewComment(name, username, content, profileImageUrl, userId) {
    const commentId = "new-" + Date.now();
    const commentHtml = `
        <div class="post-top">
            <div class="post-heading">
                <img src="${profileImageUrl}" alt="" width="30" height="30" class="rounded-circle me-2">
                <h5 data-userid="${userId}">${name} <br><span>@${username}</span></h5>
            </div>
            <div class="post-actions comment-actions" data-commentId="${commentId}">
                <a class="like-comment"><i class="bi bi-heart"></i> 0 </a>
            </div>
        </div>
        <div class="post-content comment-content">
            <p class="content" data-mentions='[]'>${content}</p>
        </div>
        <hr>
    `;

    $(".all-comments .no-data").remove();
    $("#SMN").remove();
    $(".all-comments").prepend(commentHtml);
    return $(".all-comments .post-top").first();
}

function submitComment() {
    const postId = $(".active-post").data("postid");
    const postUserId = $(".post-detail .post-heading h5").data("userid");
    const postContent = $(".my-comment input").val().trim();
    const currentUserName = $("#submitComment").data("current_user_name");
    const currentUserUsername = $("#submitComment").data("current_user_username");
    const currentUserProfileImage = $(".my-comment img").attr("src");
    const currentUserId = getCurrentUserId();
    let comments = (parseInt($(".comments span").text(), 10) || 0) + 1;

    if (!postContent) {
        return;
    }

    $(".my-comment input").val("");
    $("#submitComment").prop("disabled", true);

    const $newComment = appendNewComment(
        currentUserName,
        currentUserUsername,
        postContent,
        currentUserProfileImage,
        currentUserId
    );

    $.ajax({
        url: "/FullPost/" + postId,
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({
            content: postContent,
            state: 1
        }),
        headers: { "Content-Type": "application/json" },
        success: function (response) {
            comments = response.comments_count || comments;
            $(".comments span").text(comments);
            $newComment.next(".comment-content").find(".content").attr("data-mentions", JSON.stringify(response.mentions || []));
            initializeCommentsFragment($(".full-post"));

            sendNotification({
                recipientId: postUserId,
                title: "New Comment",
                type: "new_comment",
                identifier: postId,
                message: comments > 1
                    ? currentUserName + " and " + comments + " others commented on your post."
                    : currentUserName + " commented on your post.",
                Push: comments > 0 ? "false" : "true",
                state: 3
            });

            if ([100, 1000, 10000].includes(comments)) {
                const milestoneLabel = comments >= 1000 ? (comments / 1000) + "k" : String(comments);
                sendNotification({
                    recipientId: postUserId,
                    title: milestoneLabel + " Comments",
                    type: "post_comment_milestone",
                    identifier: postId,
                    message: "Your post has reached " + milestoneLabel + " comments!",
                    Push: "true",
                    state: 3
                });
            }

            $.ajax({
                url: "/send-mention-notifications",
                method: "POST",
                data: JSON.stringify({
                    post_id: response.comment_id,
                    state: "comment"
                }),
                headers: { "Content-Type": "application/json" }
            });
        },
        error: function (err) {
            console.error("Failed to submit comment:", err);
            $newComment.next(".comment-content").next("hr").remove();
            $newComment.next(".comment-content").remove();
            $newComment.remove();
            $(".comments span").text(Math.max(comments - 1, 0));

            if ($(".all-comments .post-top").length === 0) {
                $(".all-comments").html('<div class="no-data text-center py-3">No comments yet.</div>');
            }

            showSettingToast("Failed to submit comment. Please try again.", "error");
        },
        complete: function () {
            $("#submitComment").prop("disabled", false);
        }
    });
    let commentMentions = parseMentions($newComment.next(".comment-content").find(".content").data("mentions"));
    validatePostFeatures(postContent, commentMentions);
}

function checkForNotifications(id) {
    ajaxWithAbort("checkNotifications", {
        url: "/check-notifications/" + id,
        method: "GET",
        success: function (response) {
            const $btn = $(".notifications-button");
            const $svg = $btn.find("svg");

            if (!$svg.parent().hasClass("bell-wrapper")) {
                $svg.wrap('<span class="bell-wrapper position-relative d-inline-block"></span>');
            }

            const $wrapper = $btn.find(".bell-wrapper");
            if (response.unread_count > 0) {
                if ($wrapper.find(".notification-dot").length === 0) {
                    $wrapper.append('<span class="notification-dot translate-middle badge rounded-circle p-1"></span>');
                }
            } else {
                $wrapper.find(".notification-dot").remove();
            }
        },
        error: function () {
            console.error("Failed to check notifications");
        }
    });
}

exploreAccounts("/exploreAccounts/0/random");
initializeDynamicContent($(document.body));
ChatFlickNav.start();

$(".search input").on("input", function () {
    const query = $(this).val().trim();
    if (query.length > 0) {
        exploreAccounts("/exploreAccounts/0/" + encodeURIComponent(query));
    } else {
        exploreAccounts("/exploreAccounts/0/random");
    }
});

function runHashtagSearch(hashtag) {
    const query = (hashtag || "").trim();

    if (!query.startsWith("#")) {
        return;
    }

    showExploreView();
    $(".search input").val(query);
    exploreAccounts("/exploreAccounts/0/" + encodeURIComponent(query));
}

$(document).on("click", ".hashtag-link", function (e) {
    e.preventDefault();
    e.stopPropagation();
    runHashtagSearch($(this).data("hashtag") || $(this).text());
});

$(".nav li a").on("click", function () {
    $(".nav a").removeClass("active link-dark").addClass("link-dark");
    $(this).addClass("active").removeClass("link-dark");
});

$(document).on("click.hybridLinks", "a[href]", function (e) {
    const href = $(this).attr("href");

    if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey ||
        $(this).attr("target") ||
        $(this).attr("download") ||
        !href ||
        href === "#" ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
    ) {
        return;
    }

    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) {
        return;
    }

    const path = url.pathname + url.search;
    if (/^\/(home|mobile-home|profile\/\d+|post\/\d+|notifications|Manzoid-AI|liked|explore)(\?|$)/.test(path)) {
        e.preventDefault();
        ChatFlickNav.navigate(path);
    }
});

$(".verification-box button").on("click", function () {
    const userId = getCurrentUserId();
    const button = $("#verifyBtn");

    button.prop("disabled", true);
    button.html('<span class="btn-loader"></span>Sending...');

    ajaxWithAbort("emailVerification", {
        url: "/email-verification",
        method: "POST",
        data: JSON.stringify({ user_id: userId }),
        contentType: "application/json",
        success: function (response) {
            if (response.status === "success") {
                button.html('<span class="btn-loader"></span>Verification in progress...');
                if ($("#verification-status").length === 0) {
                    button.after('<strong id="verification-status" class="verification-tag">Verification email sent! Please check your inbox.</strong>');
                }
            } else {
                showSettingToast("Failed to send verification email. Please try again.", "error");
            }
        }
    });
});

// $(".div4 button").on("click", function () {
//     $(".ai-bar").hide();
//     $(".notifications-tab").hide();
//     $(".full-post").hide();
//     $(".explore-tab").show();
//     showPosts(0, 0);
// });

$(".switch-account-link").on("click", function () {
    const confirmSwitch = confirm("Are you sure you want to switch accounts? Unsaved changes will be lost.");

    if (confirmSwitch) {
        window.location.href = "/logout/2";
    } else {
        Backtohome();
    }
});

$(".notifications-button").on("click", function (e) {
    e.preventDefault();
    ChatFlickNav.navigate("/notifications");
});

$(document).off("click.notificationsBack", ".notification-header .bi-arrow-left")
    .on("click.notificationsBack", ".notification-header .bi-arrow-left", function (e) {
        e.preventDefault();
        $(".notifications-tab").hide();
        $(".explore-tab").show();
        $(".ai-bar").hide();
    });

$(".ai-button").on("click", function (e) {
    e.preventDefault();
    ChatFlickNav.navigate("/Manzoid-AI");
});

$(".post-button").on("click", function (e) {
    e.preventDefault();
    ChatFlickNav.navigate("/home");
    setTimeout(function () {
        $("textarea[name='post-input']").trigger("focus");
    }, 150);
});

$(".explore-button").on("click", function (e) {
    e.preventDefault();
    ChatFlickNav.navigate("/explore");
});

$(".likes-button").on("click", function (e) {
    e.preventDefault();
    ChatFlickNav.navigate("/liked");
});

$(document).on("click", "#like-post", function (e) {
    e.preventDefault();
    $(".likes-button").addClass("active").removeClass("link-dark");
    showLikedView();
});
$(".profile-link").on("click", function (e) {
    e.preventDefault();
    ChatFlickNav.navigate("/profile/" + getCurrentUserId());
});

$(".home-link").on("click", function (e) {
    e.preventDefault();
    ChatFlickNav.navigate("/home");
});

$(window).on("scroll.feedInfinite", maybeLoadMorePosts);
$(".div3").on("scroll.feedInfinite", maybeLoadMorePosts);

$(document).off("click.topPages", ".top-pages h6").on("click.topPages", ".top-pages h6", function (e) {
    e.preventDefault();
    e.stopPropagation();

    $(".top-pages h6").removeClass("active-a");
    $(this).addClass("active-a");

    const state = parseInt($(this).data("state"), 10);
    const userId = $(this).data("userid");
    showPosts(state, userId);
});

$(document).off("click.submitPost", ".submit button").on("click.submitPost", ".submit button", function () {
    const $button = $(this);
    const content = $("textarea[name='post-input']").val().trim();
    const userId = $button.data("userid");

    if (!content) {
        updateComposerState($("textarea[name='post-input']"));
        return;
    }

    $("textarea[name='post-input']").val("");
    updateComposerState($("textarea[name='post-input']"));
    $button.prop("disabled", true);

    const tempPostId = prependPost(content, userId);


    ajaxWithAbort("submitPost", {
        url: "/managePosts/1",
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({ content: content, user_id: userId }),
        success: function (response) {
            if (response.status !== "success") {
                $('.div3 .post[data-postid="' + tempPostId + '"]').remove();
                showSettingToast("Failed to post. Please try again.", "error");
                return;
            }

            const $newPost = $('.div3 .post[data-postid="' + tempPostId + '"]');
            $newPost.attr("data-postid", response.post_id);
            $newPost.find(".post-content .hashtag").text(response.hashtags);
            $newPost.find(".post-content .content").attr("data-mentions", JSON.stringify(response.mentions || []));
            $newPost.find(".post-time").attr("data-timestamp", response.timestamp).text("Just now");
            $newPost.find(".edit-post").attr("title", "Edit Post").html(
                '<svg style="width: 22px; cursor:pointer" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640"><path d="M505 122.9L517.1 135C526.5 144.4 526.5 159.6 517.1 168.9L488 198.1L441.9 152L471 122.9C480.4 113.5 495.6 113.5 504.9 122.9zM273.8 320.2L408 185.9L454.1 232L319.8 366.2C316.9 369.1 313.3 371.2 309.4 372.3L250.9 389L267.6 330.5C268.7 326.6 270.8 323 273.7 320.1zM437.1 89L239.8 286.2C231.1 294.9 224.8 305.6 221.5 317.3L192.9 417.3C190.5 425.7 192.8 434.7 199 440.9C205.2 447.1 214.2 449.4 222.6 447L322.6 418.4C334.4 415 345.1 408.7 353.7 400.1L551 202.9C579.1 174.8 579.1 129.2 551 101.1L538.9 89C510.8 60.9 465.2 60.9 437.1 89zM152 128C103.4 128 64 167.4 64 216L64 488C64 536.6 103.4 576 152 576L424 576C472.6 576 512 536.6 512 488L512 376C512 362.7 501.3 352 488 352C474.7 352 464 362.7 464 376L464 488C464 510.1 446.1 528 424 528L152 528C129.9 528 112 510.1 112 488L112 216C112 193.9 129.9 176 152 176L264 176C277.3 176 288 165.3 288 152C288 138.7 277.3 128 264 128L152 128z" /></svg>'
            );
            initializePostsFragment($newPost.parent());

            sendNotification({
                title: "New Post",
                type: "new_post",
                identifier: response.post_id,
                senderId: userId,
                message: response.username + " has just posted a new tweet.",
                state: 2,
                Push: "true"
            });

            $.ajax({
                url: "/send-mention-notifications",
                method: "POST",
                data: JSON.stringify({
                    post_id: response.post_id,
                    state: "post"
                }),
                headers: { "Content-Type": "application/json" }
            });
        },
        error: function () {
            $('.div3 .post[data-postid="' + tempPostId + '"]').remove();
            showSettingToast("An error occurred. Please try again.", "error");
        },
    });

    validatePostFeatures(content, JSON.parse($("textarea[name='post-input']").attr("data-mentions") || "[]"));
});

$(document).off("input.postComposer", "textarea[name='post-input']").on("input.postComposer", "textarea[name='post-input']", function () {
    updateComposerState($(this));
});

$(document).off("click.profileBack", ".backtohome").on("click.profileBack", ".backtohome", Backtohome);

$(document).off("click.profilePicture", ".profile-pic-wrapper").on("click.profilePicture", ".profile-pic-wrapper", function () {
    const $input = $(this).find("#profileInput");
    if ($input.length) {
        $input.trigger("click");
    }
});

$(document).off("change.profileInput", "#profileInput").on("change.profileInput", "#profileInput", function () {
    const userId = $(this).closest(".info").data("user-id");
    const userChoice = confirm("Are you sure you want to update your profile picture?");

    if (!userChoice) {
        this.value = "";
        return;
    }

    uploadProfileImage(this, "/update-profile/" + userId);
    sendNotification({
        recipientId: null,
        title: "Profile Updated",
        type: "profile_update",
        identifier: userId,
        message: "Has updated his profile picture.",
        state: 2
    });
});
$(document)
    .off("click.profileActions", "#profile-data small")
    .on("click.profileActions", "#profile-data small", async function () {

        const $btn = $(this);
        const accountId = $btn.data("user-id");

        if ($btn.hasClass("Follow")) {
            $.ajax({
                url: "/follows/" + accountId + "/1",
                type: "POST",
                success: function () {
                    $btn
                        .text("Following")
                        .removeClass("Follow")
                        .addClass("Following");
                }
            });
            return;
        }

        if ($btn.hasClass("Following")) {
            $.ajax({
                url: "/follows/" + accountId + "/2",
                type: "POST",
                success: function () {
                    $btn
                        .text("Follow")
                        .removeClass("Following")
                        .addClass("Follow");
                }
            });
            return;
        }

        if ($btn.hasClass("share-profile")) {
            const username = $btn.data("username") || "This user";

            const shareData = {
                title: `${username}'s ChatFlick Profile`,
                text: `User: ${username}\nCheck out this profile on ChatFlick`,
                url: window.location.href
            };

            try {
                if (navigator.share) {
                    await navigator.share(shareData);
                } else {
                    await navigator.clipboard.writeText(window.location.href);
                    showSettingToast(
                        "Profile link copied for sharing.",
                        "success"
                    );
                }
            } catch (err) {
                console.log("Profile share cancelled.");
            }
        }
    });

$(document)
    .off("click.profileFollowers", ".followers")
    .on("click.profileFollowers", ".followers", function () {

        const userId = $(this)
            .closest(".account-audience")
            .data("user-id");

        exploreAccounts(`/exploreAccounts/${userId}/followers`);
    });

$(document)
    .off("click.profileFollowing", ".following")
    .on("click.profileFollowing", ".following", function () {

        const userId = $(this)
            .closest(".account-audience")
            .data("user-id");

        exploreAccounts(`/exploreAccounts/${userId}/following`);
    });


$(document).off("click.profileOptions", ".ProfileOptions h6").on("click.profileOptions", ".ProfileOptions h6", function () {
    $(".ProfileOptions h6").removeClass("active-a");
    $(this).addClass("active-a");

    const option = $(this).text().trim();
    const userId = $(".ProfileOptions").attr("class").split(" ")[1];

    if (option === "Posts") {
        showPosts(1, userId);
    } else if (option === "Likes") {
        showPosts(3, userId);
    } else if (option === "Reposts") {
        showPosts(4, userId);
    } else if (option === "About") {
        loadFragment(
            "profileAbout",
            $(".div3"),
            "/profile/" + userId + "/about",
            '<div class="page-loader page-loader--profile"><span class="loader2"></span></div>'
        );
    }
});

$(document).off("dblclick.showFullPost", ".post").on("dblclick.showFullPost", ".post", showFullPost);
$(document).off("click.showFullPost", ".comment").on("click.showFullPost", ".comment", showFullPost);

$(document).off("click.postProfile", ".post-heading h5").on("click.postProfile", ".post-heading h5", function () {
    const profileId = $(this).data("userid");
    if (profileId) {
        ChatFlickNav.navigate("/profile/" + profileId);
    }
});

$(document).off("click.options-menu", ".options-menu a")
    .on("click.options-menu", ".options-menu a", async function (e) {
        e.stopPropagation();
        let clickID = $(this).attr("id");

        if (clickID === "notification-settings") {
            return;
        }

        if ($(this).closest(".notification-options").length) {
            e.preventDefault();
            $(".options-menu.show").removeClass("show");

            if (clickID === "mark-notifications-read") {
                markAsRead();
                showSettingToast("Notifications marked as read.", "success");
            } else if (clickID === "clear-notifications") {
                $.ajax({
                    url: "/notifications/clear",
                    type: "POST",
                    success: function () {
                        loadNotifications();
                        checkForNotifications(getCurrentUserId());
                        showSettingToast("Notifications cleared.", "success");
                    },
                    error: function () {
                        showSettingToast("Unable to clear notifications right now.", "error");
                    }
                });
            } else if (clickID === "refresh-notifications") {
                loadNotifications();
            }

            return;
        }

        if (clickID === "report-post") {
            e.preventDefault();
            const postId = $(this).closest(".options-menu").data("postid")
                || $(this).closest(".post, .post-detail").data("postid");
            $(".report-center").data("postid", postId).show();
        } else if (clickID === "follow-me") {
            showSettingToast("This feature is comming soon!", "Notice");
        } else if (clickID === "add-to-favorites") {
            showSettingToast("This feature is comming soon!", "Notice");
        } else if (clickID === "interested-in-post") {
            showSettingToast("You'll see more posts like this!", "Success");
        } else if (clickID === "not-interested-in-post") {
            showSettingToast("You'll see less posts like this!", "Success");
        } else if (clickID === "copy-link") {
            e.preventDefault();
            const postId = $(this).closest(".options-menu").data("postid")
                || $(this).closest(".post, .post-detail").data("postid")
                || $(".post-detail").data("postid");
            if (postId && navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(getPostPermalink(postId));
                showSettingToast("Post link copied to clipboard.", "success");
            } else if (postId) {
                window.prompt("Copy post link", getPostPermalink(postId));
            }
        } else if (clickID === "block-user") {
            showSettingToast("This feature is comming soon!", "Notice");
        } else if (clickID === "about-this-account") {

            showSettingToast("This feature is coming soon!", "Notice");

        } else if (clickID === "copy-profile-link") {

            const profileUrl = window.location.href;

            if (navigator.clipboard && window.isSecureContext) {
                try {
                    await navigator.clipboard.writeText(profileUrl);
                    showSettingToast("Profile link copied to clipboard.", "success");
                } catch (err) {
                    showSettingToast("Unable to copy profile link.", "error");
                }
            } else {
                window.prompt("Copy profile link", profileUrl);
            }

        } else if (clickID === "report-user") {

            // Open your report modal here
            showSettingToast("This feature is coming soon!", "Notice");

        } else if (clickID === "share-profile") {

            const username =
                $(".profile-username").text().trim() ||
                window.location.pathname.split("/").pop();

            const shareData = {
                title: `${username}'s ChatFlick Profile`,
                text: [
                    `User: ${username}`,
                    "Check out this profile on ChatFlick"
                ].join("\n"),
                url: window.location.href
            };

            try {
                if (navigator.share) {
                    await navigator.share(shareData);
                } else {
                    await navigator.clipboard.writeText(window.location.href);
                    showSettingToast("Profile link copied for sharing.", "success");
                }
            } catch (err) {
                console.log("Profile share cancelled.");
            }

        } else if (clickID === "block-user") {

            showSettingToast("This feature is coming soon!", "Notice");

        }

    });


$(document).off("click.close-report", ".report-center .close")
    .on("click.close-report", ".report-center .close", function (e) {
        e.stopPropagation();
        $(".report-center").removeData("postid").hide();
    });

$(document).off("click.report-submit", "#reportSBtn")
    .on("click.report-submit", "#reportSBtn", function (e) {
        e.preventDefault();
        e.stopPropagation();

        // Call your function here
        submitReportContent();
    });

function submitReportContent() {
    const problem = $("#report-center-input").val().trim();
    const category = $("#report-category").val();
    const $button = $("#reportSBtn");
    const $answer = $("#support-ai-answer");
    const postId = $(".report-center").data("postid") || $("#post-options").data("postid");

    if (!postId) {
        showSettingToast("Unable to find the post you want to report.", "error");
        return;
    }

    if (!category || category === "No Reason Selected") {
        showSettingToast("Please select a report reason before submitting.", "error");
        return;
    }

    $button.prop("disabled", true).text("Submitting...");
    $answer.hide().text("");
    $.ajax({
        url: "/reports/posts",
        type: "POST",
        data: JSON.stringify({
            post_id: postId,
            category: category,
            message: problem
        }),
        contentType: "application/json",
        success: function (data) {
            showSettingToast(data?.message || "Report submitted successfully.", "success");
            $("#report-center-input").val("");
            $("#report-category").val("No Reason Selected");
            $(".report-center").removeData("postid").hide();
        },
        error: function (err) {
            const message = err?.responseJSON?.message || "Unable to submit your report right now.";
            showSettingToast(message, "error");
        },
        complete: function () {
            $button.prop("disabled", false).text("Submit");
        }
    });
};



$(document).off("click.editPost", ".edit-post").on("click.editPost", ".edit-post", function () {
    const editLink = $(this);
    const postDiv = editLink.closest(".post");
    const postId = postDiv.data("postid");
    const contentP = postDiv.find(".post-content .content");
    const originalContent = contentP.text().trim();
    const textarea = $('<textarea class="form-control" maxlength="180" rows="3"></textarea>').val(originalContent);
    const deleteBtn = $('<small class="edit-action delete"><u>Delete</u></small>');
    const saveBtn = $('<small class="edit-action save"><u>Save</u></small>');
    const cancelBtn = $('<small class="edit-action cancel"><u>Cancel</u></small>');
    const btnContainer = $('<div class="edit-btn-container m-1" style="display:flex; justify-content:space-between;"></div>');

    contentP.replaceWith(textarea);
    textarea.trigger("focus");
    btnContainer.append(deleteBtn, cancelBtn, saveBtn);
    postDiv.find(".post-content").after(btnContainer);
    editLink.hide();

    saveBtn.on("click", function () {
        const confirmChange = confirm("Do you want to update you post. This action cannot be undone.");
        if (!confirmChange) {
            return;
        }

        $.ajax({
            url: "/managePosts/2",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({
                post_id: postId,
                content: textarea.val().trim()
            }),
            success: function (res) {
                textarea.replaceWith($('<p class="content"></p>').text(res.content || ""));
                btnContainer.remove();
                editLink.show();
            }
        });
    });

    cancelBtn.on("click", function () {
        textarea.replaceWith($('<p class="content"></p>').text(originalContent));
        btnContainer.remove();
        editLink.show();
    });

    deleteBtn.on("click", function () {
        const confirmChange = confirm("Are you sure you want to delete this post? This action cannot be undone.");
        if (!confirmChange) {
            return;
        }

        $.ajax({
            url: "/managePosts/3",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({ post_id: postId }),
            success: function () {
                postDiv.remove();
            }
        });
    });
});

$(document).off("click.likePost", ".like").on("click.likePost", ".like", function (e) {
    e.preventDefault();

    const $btn = $(this);
    if ($btn.data("loading")) {
        return;
    }

    $btn.data("loading", true);

    const $icon = $btn.find("i");
    const postId = $btn.closest(".post").data("postid");
    const wasLiked = $btn.hasClass("text-warning") || $icon.hasClass("bi-heart-fill");
    const textNode = getTextNode($btn);
    const count = parseInt(textNode.text().trim(), 10) || 0;
    const newCount = wasLiked ? count - 1 : count + 1;

    $btn.toggleClass("text-warning", !wasLiked);
    $icon.toggleClass("bi-heart-fill", !wasLiked);
    $icon.toggleClass("bi-heart", wasLiked);
    textNode[0].nodeValue = " " + newCount;

    $.ajax({
        url: "/PostAction/1",
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({
            post_id: postId,
            like: !wasLiked
        }),
        success: function (res) {
            textNode[0].nodeValue = " " + res.likes;

            if (!wasLiked) {
                sendNotification({
                    recipientId: res.user_id,
                    title: "New Like!",
                    type: "post_like",
                    identifier: postId,
                    message: res.likes > 1
                        ? res.current_user_name + " and " + (res.likes - 1) + " others liked your post."
                        : res.current_user_name + " liked your post.",
                    Push: res.likes > 1 ? "false" : "true",
                    state: 3
                });

                if ([100, 1000, 10000].includes(res.likes)) {
                    const label = res.likes >= 1000 ? (res.likes / 1000) + "k" : String(res.likes);
                    sendNotification({
                        recipientId: res.user_id,
                        title: label + " Likes",
                        type: "post_like_milestone",
                        identifier: postId,
                        message: "Your post has reached " + label + " likes!",
                        Push: "true",
                        state: 3
                    });
                }
            }
        },
        error: function () {
            showSettingToast("An error occurred while processing your like. Please try again.", "error");
            $btn.toggleClass("text-warning", wasLiked);
            $icon.toggleClass("bi-heart-fill", wasLiked);
            $icon.toggleClass("bi-heart", !wasLiked);
            textNode[0].nodeValue = " " + count;
        },
        complete: function () {
            $btn.data("loading", false);
        }
    });
});

$(document).off("click.retweetPost", ".retweet").on("click.retweetPost", ".retweet", function (e) {
    e.preventDefault();

    const $btn = $(this);
    if ($btn.data("loading")) {
        return;
    }

    $btn.data("loading", true);

    const $icon = $btn.find("i");
    const postId = $btn.closest(".post").data("postid");
    const wasReposted = $btn.hasClass("text-warning");
    const textNode = getTextNode($btn);
    const count = parseInt(textNode.text().trim(), 10) || 0;
    const newCount = wasReposted ? count - 1 : count + 1;

    $btn.toggleClass("text-warning", !wasReposted);
    textNode[0].nodeValue = " " + newCount;
    $icon.removeClass("rotate");
    void $icon[0].offsetWidth;
    $icon.addClass("rotate");

    $.ajax({
        url: "/PostAction/2",
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({
            post_id: postId,
            repost: !wasReposted
        }),
        success: function (res) {
            textNode[0].nodeValue = " " + res.reposts;

            if (!wasReposted) {
                sendNotification({
                    recipientId: res.user_id,
                    title: "New Retweet!",
                    type: "post_retweet",
                    identifier: postId,
                    message: res.reposts > 1
                        ? res.current_user_name + " and " + (res.reposts - 1) + " others retweeted your post."
                        : res.current_user_name + " retweeted your post.",
                    Push: res.reposts > 1 ? "false" : "true",
                    state: 3
                });

                if ([100, 1000, 10000].includes(res.reposts)) {
                    const label = res.reposts >= 1000 ? (res.reposts / 1000) + "k" : String(res.reposts);
                    sendNotification({
                        recipientId: res.user_id,
                        title: label + " Retweets",
                        type: "post_retweet_milestone",
                        identifier: postId,
                        message: "Your post has reached " + label + " retweets!",
                        Push: "true",
                        state: 3
                    });
                }
            }
        },
        error: function () {
            $btn.toggleClass("text-warning", wasReposted);
            textNode[0].nodeValue = " " + count;
        },
        complete: function () {
            $btn.data("loading", false);
        }
    });
});

$(document).off("click.sharePost", ".share, .shares").on("click.sharePost", ".share, .shares", async function (e) {
    e.preventDefault();

    const $btn = $(this);
    const context = getShareContext($btn);
    const postId = context.postId;
    const text = context.text || "Check out this post on ChatFlick";
    const url = getPostPermalink(postId);

    if (!postId || String(postId).indexOf("temp-") === 0) {
        console.warn("Share aborted: invalid post id", postId);
        return;
    }

    if ($btn.data("loading")) {
        return;
    }

    $btn.data("loading", true);

    function getShortText(text, maxLength = 100) {
        return text.length > maxLength
            ? text.substring(0, maxLength) + "..."
            : text;
    }

    const shortText = getShortText(text);
    const shareText = shortText;
    const shareData = {
        title: "ChatFlick Post",
        text: shareText,
        url: url
    };

    try {
        const result = await sharePostContent(shareData);

        if (result.mode === "clipboard") {
            showSettingToast("Post copied to clipboard.", "success");
        }

        $.ajax({
            url: "/PostAction/4",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({
                post_id: postId
            }),
            success: function (res) {
                if (typeof res.shares === "number") {
                    setActionCount($btn, res.shares);
                }
            },
            error: function (xhr) {
                console.error("Share count update failed:", xhr.responseJSON || xhr);
            },
            complete: function () {
                $btn.data("loading", false);
            }
        });
    } catch (err) {
        if (err && err.name === "AbortError") {
            $btn.data("loading", false);
            return;
        }

        console.error("Share failed:", err);
        showSettingToast("Unable to share this post right now.", "error");
        $btn.data("loading", false);
    }
});

$(document).off("click.likeComment", ".like-comment").on("click.likeComment", ".like-comment", function (e) {
    e.preventDefault();

    const $btn = $(this);
    const $icon = $btn.find("i");
    const textNode = getTextNode($btn);
    const likes = parseInt(textNode.text().trim(), 10) || 0;
    const wasLiked = $icon.hasClass("bi-heart-fill");
    const postId = $btn.closest(".comment-actions").data("commentid");
    const newLikes = wasLiked ? likes - 1 : likes + 1;

    $btn.toggleClass("text-warning", !wasLiked);
    $icon.toggleClass("bi-heart-fill", !wasLiked);
    $icon.toggleClass("bi-heart", wasLiked);
    textNode[0].nodeValue = " " + newLikes;

    $.ajax({
        url: "/PostAction/3",
        method: "POST",
        contentType: "application/json",
        data: JSON.stringify({
            post_id: postId,
            like: !wasLiked
        }),
        success: function (res) {
            textNode[0].nodeValue = " " + res.likes;
        },
        error: function (err) {
            console.error("Failed to like comment:", err);
            $btn.toggleClass("text-warning", wasLiked);
            $icon.toggleClass("bi-heart-fill", wasLiked);
            $icon.toggleClass("bi-heart", !wasLiked);
            textNode[0].nodeValue = " " + likes;
            showSettingToast("Failed to update like. Please try again.", "error");
        }
    });
});

$(document).off("click.commentBack", ".back-post > i").on("click.commentBack", ".back-post > i", function (e) {
    e.preventDefault();
    if (/^\/post\/\d+$/.test(window.location.pathname) && window.history.length > 1) {
        window.history.back();
        return;
    }
    $(".post").removeClass("active-post");
    $(".explore-tab").show();
    $(".full-post").hide();
});
$(document).off("click.submitComment", "#submitComment").on("click.submitComment", "#submitComment", submitComment);
$(document).off("keydown.submitComment", ".my-comment input").on("keydown.submitComment", ".my-comment input", function (e) {
    if (e.key === "Enter") {
        e.preventDefault();
        submitComment();
    }
});

checkForNotifications(getCurrentUserId());

function initializeOptionsToggle($root) {

    let root = document;

    // jQuery object
    if ($root && $root.length) {
        root = $root[0];
    }

    // Native DOM element
    else if ($root instanceof Element) {
        root = $root;
    }

    const toggles = root.querySelectorAll(".options-toggle");

    toggles.forEach(function (toggleBtn) {

        const menu = toggleBtn.closest(".post-options")?.querySelector(".options-menu");

        if (!menu || toggleBtn.__optionsToggleInitialized) {
            return;
        }

        toggleBtn.__optionsToggleInitialized = true;

        toggleBtn.addEventListener("click", function (e) {

            e.stopPropagation();

            const isOpen = menu.classList.contains("show");

            document.querySelectorAll(".options-menu.show").forEach(function (m) {
                m.classList.remove("show");
            });

            if (!isOpen) {
                menu.classList.add("show");
            }

        });

    });

}
// Close on outside click
document.addEventListener("click", function (e) {

    if (!e.target.closest(".post-options") && !e.target.closest(".options-menu")) {

        document.querySelectorAll(".options-menu.show").forEach(function (menu) {
            menu.classList.remove("show");
        });

    }

});
