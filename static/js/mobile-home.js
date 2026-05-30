const mobileControllers = {};
let mobileCurrentUserId = 0;
const MOBILE_FEED_PER_PAGE = 10;
const mobileFeedState = {
    state: 0,
    id: 0,
    loading: false,
    hasMore: true,
    active: false
};

function showMobileToast(message, type = "info") {
    const stack = document.getElementById("mobileToastStack");
    if (!stack || !message) {
        return;
    }

    const normalizedType = ["success", "error", "info"].includes(type) ? type : "info";
    const toast = document.createElement("article");
    toast.className = "mobile-toast mobile-toast--" + normalizedType;
    toast.setAttribute("role", normalizedType === "error" ? "alert" : "status");
    toast.innerHTML = '<strong></strong><span></span><button type="button" aria-label="Close notification">&times;</button>';
    toast.querySelector("strong").textContent = normalizedType === "success"
        ? "Success"
        : normalizedType === "error"
            ? "Something went wrong"
            : "Notice";
    toast.querySelector("span").textContent = message;

    const removeToast = function () {
        if (toast.classList.contains("is-removing")) {
            return;
        }
        toast.classList.add("is-removing");
        window.setTimeout(function () {
            toast.remove();
        }, 220);
    };

    toast.querySelector("button").addEventListener("click", removeToast);
    stack.appendChild(toast);
    window.setTimeout(removeToast, 3800);
}

function abortAndRenew(key) {
    if (mobileControllers[key]) {
        mobileControllers[key].abort();
    }

    mobileControllers[key] = new AbortController();
    return mobileControllers[key];
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
    const fromBody = $("body").data("current-user-id");
    const fromComposer = $(".submit button").data("userid");
    const fromNotifications = $(".notifications").data("userid");
    const fromProfile = $(".info").data("user-id");
    const foundUserId = parseInt(fromComposer || fromNotifications || fromProfile || fromBody || 0, 10);

    if (fromComposer || !mobileCurrentUserId) {
        mobileCurrentUserId = foundUserId || mobileCurrentUserId;
    }

    return mobileCurrentUserId || foundUserId;
}

function getPostPermalink(postId) {
    return new URL("/post/" + postId, window.location.origin).href;
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

function buildShareText(username, content) {
    return [
        "User: " + (username || "ChatFlick user"),
        "Post: " + (content || "Check out this post on ChatFlick")
    ].join("\n");
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

    const diffMins = Math.max(0, Math.floor((new Date() - date) / 60000));

    if (diffMins >= 43200) {
        return formatLocalTimestamp(timestamp);
    }

    if (diffMins < 1) {
        return "Just now";
    }
    if (diffMins < 60) {
        return diffMins === 1 ? "1m ago" : diffMins + "m ago";
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

    const diffMins = Math.max(0, Math.floor((new Date() - date) / 60000));

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
            text = text.replace(regex, '<span onclick="ChatFlickMobileNav.navigate(\'/profile/' + mention.user_id + '\')" class="mention" style="cursor: pointer;" title="View profile">@' + mention.username + "</span>");
        });

        el.innerHTML = text;
    });
}

function initializeDynamicContent($root) {
    $root.find(".profile-tab").hide();

    $root.find("textarea[name='post-input']").each(function () {
        updateComposerState($(this));
    });

    if ($root.find(".notifications, #notifications-permission").length) {
        const permissionWarning = document.getElementById("notifications-permission");
        if (permissionWarning) {
            const pushIssue = typeof window.getPushSupportIssue === "function" ? window.getPushSupportIssue() : "";
            if (pushIssue) {
                const messageNode = permissionWarning.querySelector("p.text-muted");
                if (messageNode) {
                    messageNode.textContent = pushIssue;
                }
            } else if ("Notification" in window && Notification.permission === "granted") {
                $root.find("#notifications-permission").remove();
                if (typeof window.enableNotifications === "function") {
                    window.enableNotifications(false);
                }
            }
            $root.find(".notifications").show();
        }
    }

    $root.find(".post-time").each(function () {
        const display = formatRelativeTime($(this).data("timestamp"));
        if (display) {
            $(this).text(display);
        }
    });

    $root.find(".notification-message span").each(function () {
        const display = formatCompactRelativeTime($(this).data("timestamp"));
        if (display) {
            $(this).text(display);
        }
    });

    renderMentions(".post-content .content, .comment-content .content");
    initializeOptionsToggle($root);
    $root.find(".ProfileOptions h6").removeClass("active-a").first().addClass("active-a");
}

function initializeOptionsToggle($root) {
    let root = document;

    if ($root && $root.length) {
        root = $root[0];
    } else if ($root instanceof Element) {
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

            document.querySelectorAll(".options-menu.show").forEach(function (openMenu) {
                openMenu.classList.remove("show");
            });

            if (!isOpen) {
                menu.classList.add("show");
            }
        });
    });
}

document.addEventListener("click", function (e) {
    if (!e.target.closest(".post-options") && !e.target.closest(".options-menu")) {
        document.querySelectorAll(".options-menu.show").forEach(function (menu) {
            menu.classList.remove("show");
        });
    }
});

function injectHtmlResponse($target, response) {
    const dummy = $("<div>").html(response);
    dummy.find("script").remove();
    $target.html(dummy.html());

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

const ChatFlickMobileNav = (function () {
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
            return { name: "home", url: "/mobile-home" };
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
            return { name: "search", url: path };
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
            postSection: $(".post-section").html(),
            feedPost: $("#feed-post").html(),
            accountsHidden: $(".accounts-row").prop("hidden"),
            moreHidden: $(".more-menu-overlay").prop("hidden"),
            activeTab: $(".navigation .list.active .text").text().trim(),
            mobileFeedState: $.extend({}, mobileFeedState),
            scroll: {
                windowX: window.scrollX,
                windowY: window.scrollY,
                feed: $(".feed-preview").scrollTop()
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
        resetOverlay();
        $(".post-section").html(entry.postSection);
        $("#feed-post").html(entry.feedPost);
        $(".accounts-row").prop("hidden", entry.accountsHidden).toggle(!entry.accountsHidden);
        $(".more-menu-overlay").prop("hidden", entry.moreHidden);
        $.extend(mobileFeedState, entry.mobileFeedState || {});
        if (entry.activeTab) {
            setActiveTab(entry.activeTab);
        }
        initializeDynamicContent($(".post-section, #feed-post"));
        window.setTimeout(function () {
            $(".feed-preview").scrollTop(entry.scroll.feed || 0);
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

        renderMobileRoute(route);
        currentKey = nextKey;

        if (!opts.fromPop) {
            setHistory(route, opts.replace);
        }
    }

    function start() {
        window.history.scrollRestoration = "manual";
        const route = routeFor(window.location.href) || { name: "home", url: "/mobile-home" };
        currentKey = keyFor(route.url);
        setHistory(route, true);
        renderMobileRoute(route);

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
window.ChatFlickMobileNav = ChatFlickMobileNav;

function getLoadedPostIds($target) {
    return $target.find(".post").map(function () {
        const postId = $(this).data("postid");
        return /^\d+$/.test(String(postId)) ? postId : null;
    }).get();
}

function buildPostsUrl(state, id, append) {
    const params = new URLSearchParams({
        per_page: MOBILE_FEED_PER_PAGE
    });

    if (append) {
        params.set("append", "1");
        params.set("exclude_ids", getLoadedPostIds($("#feed-post")).join(","));
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
    if (!mobileFeedState.active || mobileFeedState.loading || !mobileFeedState.hasMore) {
        return;
    }

    mobileFeedState.loading = true;
    const $loader = $('<div class="loader-wrapper feed-more-loader"><span class="loader"></span></div>');
    $("#feed-post").append($loader);

    ajaxWithAbort("mobileAppendPosts", {
        url: buildPostsUrl(mobileFeedState.state, mobileFeedState.id, true),
        method: "GET",
        success: function (response) {
            $loader.remove();
            const newPostCount = appendHtmlResponse($("#feed-post"), response);
            mobileFeedState.hasMore = newPostCount >= MOBILE_FEED_PER_PAGE;
        },
        error: function (jqXHR, textStatus, errorThrown) {
            $loader.remove();
            if (textStatus !== "abort") {
                console.error("Ajax error [mobileAppendPosts]:", textStatus, errorThrown);
            }
        },
        complete: function () {
            mobileFeedState.loading = false;
        }
    });
}

function isNearFeedBottom() {
    const threshold = 500;
    const $feed = $(".feed-preview");

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

function setActiveTab(label) {
    $(".navigation .list").removeClass("active");
    $(".navigation .list").filter(function () {
        return $(this).find(".text").text().trim().toLowerCase() === label.toLowerCase();
    }).addClass("active");
}

function setAccountsRowVisible(visible) {
    $(".accounts-row").prop("hidden", !visible).toggle(visible);
}

function setMoreMenuVisible(visible) {
    $(".more-menu-overlay").prop("hidden", !visible);
}

function toggleMoreMenu() {
    const isHidden = $(".more-menu-overlay").prop("hidden");
    setActiveTab("More");
    setMoreMenuVisible(isHidden);
}

function resetOverlay() {
    $(".fullpost-overlay").prop("hidden", true);
    $(".fullpost-box").empty();
    closeFollowListOverlay(false);
    if ($("#mobileReportOverlay").prop("hidden")) {
        $("body").css("overflow", "");
    }
}

function setBodyScrollForOverlays() {
    const hasOpenOverlay = !$(".fullpost-overlay").prop("hidden")
        || !$("#mobileReportOverlay").prop("hidden")
        || !$("#followListOverlay").prop("hidden");

    $("body").css("overflow", hasOpenOverlay ? "hidden" : "");
}

function closeFollowListOverlay(updateScroll) {
    $("#followListOverlay").prop("hidden", true);
    $("#followListSearch").val("");
    $(".follow-list-results").empty();
    $(".follow-list-empty").prop("hidden", true);

    if (updateScroll !== false) {
        setBodyScrollForOverlays();
    }
}

function filterFollowListAccounts(query) {
    const normalizedQuery = (query || "").toLowerCase();
    let visibleCount = 0;

    $("#followListOverlay .full-account").each(function () {
        const $account = $(this);
        const matches = $account.text().toLowerCase().indexOf(normalizedQuery) !== -1;
        $account.toggle(matches);

        if (matches) {
            visibleCount += 1;
        }
    });

    const hasAccounts = $("#followListOverlay .full-account").length > 0;
    $(".follow-list-empty").prop("hidden", !hasAccounts || visibleCount > 0);
}

function getAudienceAccountId($element) {
    const dataUserId = parseInt($element.closest(".account-audience").data("user-id"), 10);

    if (!isNaN(dataUserId)) {
        return dataUserId;
    }

    return null;
}
function openFollowListOverlay(accountId, listType) {
    const title = listType === "following" ? "Following" : "Followers";

    if (!accountId) {
        showMobileToast("Unable to find this account list.", "error");
        return;
    }

    $("#followListTitle").text(title);
    $("#followListSearch").val("");
    $(".follow-list-empty").prop("hidden", true);
    $(".follow-list-results").html('<div class="loader-wrapper"><span class="loader"></span></div>');
    $("#followListOverlay").prop("hidden", false);
    setBodyScrollForOverlays();

    ajaxWithAbort("mobileFollowList", {
        url: "/exploreAccounts/" + accountId + "/" + listType,
        method: "GET",
        success: function (response) {
            injectHtmlResponse($(".follow-list-results"), response);
            filterFollowListAccounts("");
            $("#followListSearch").trigger("focus");
        },
        error: function () {
            $(".follow-list-results").html('<div class="no-data text-center py-3 fs-6">Unable to load accounts</div>');
        }
    });
}

function openMobileReport(postId) {
    if (!postId) {
        showMobileToast("Unable to find the post you want to report.", "error");
        return;
    }

    $("#mobileReportOverlay").data("postid", postId).prop("hidden", false);
    $("#mobile-report-category").val("No Reason Selected");
    $("#mobile-report-details").val("");
    $("body").css("overflow", "hidden");
}

function closeMobileReport() {
    $("#mobileReportOverlay").removeData("postid").prop("hidden", true);
    $("#mobile-report-category").val("No Reason Selected");
    $("#mobile-report-details").val("");
    setBodyScrollForOverlays();
}

function submitMobileReport() {
    const postId = $("#mobileReportOverlay").data("postid");
    const category = $("#mobile-report-category").val();
    const message = $("#mobile-report-details").val().trim();
    const $button = $("#mobileReportSubmit");

    if (!postId) {
        showMobileToast("Unable to find the post you want to report.", "error");
        return;
    }

    if (!category || category === "No Reason Selected") {
        showMobileToast("Please select a report reason before submitting.", "error");
        return;
    }

    $button.prop("disabled", true).text("Submitting...");

    $.ajax({
        url: "/reports/posts",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify({
            post_id: postId,
            category: category,
            message: message
        }),
        success: function (data) {
            closeMobileReport();
            showMobileToast(data?.message || "Report submitted successfully.", "success");
        },
        error: function (err) {
            const message = err?.responseJSON?.message || "Unable to submit your report right now.";
            showMobileToast(message, "error");
        },
        complete: function () {
            $button.prop("disabled", false).text("Submit Report");
        }
    });
}

function updateComposerState($textarea) {
    const inputLength = $textarea.val().length;
    const maxLength = Number($textarea.attr("maxlength")) || 180;
    const progress = (inputLength / maxLength) * 100;
    const circumference = 2 * Math.PI * 22;
    const offset = (progress / 100) * circumference;
    const $container = $textarea.closest(".post-section, .container, body");

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

function showPosts(state, id) {
    if (mobileControllers.mobileAppendPosts) {
        mobileControllers.mobileAppendPosts.abort();
    }

    mobileFeedState.state = state;
    mobileFeedState.id = id;
    mobileFeedState.loading = true;
    mobileFeedState.hasMore = true;
    mobileFeedState.active = true;

    loadFragment(
        "mobilePosts",
        $("#feed-post"),
        buildPostsUrl(state, id, false),
        '<div class="loader-wrapper"><span class="loader"></span></div>'
    ).done(function () {
        mobileFeedState.hasMore = $("#feed-post .post").length >= MOBILE_FEED_PER_PAGE;
    }).always(function () {
        mobileFeedState.loading = false;
        maybeLoadMorePosts();
    });
}

function showComposer() {
    resetOverlay();
    setActiveTab("Home");
    return loadFragment(
        "mobileComposer",
        $(".post-section"),
        "/profile/0",
        '<div class="loader-wrapper"><span class="loader"></span></div>'
    ).done(function () {
        const userId = $(".submit button").data("userid");
        if (userId) {
            mobileCurrentUserId = parseInt(userId, 10);
            checkForNotifications(mobileCurrentUserId);
        }
    });
}

function showProfile(userId) {
    resetOverlay();
    setActiveTab("Profile");
    setMoreMenuVisible(false);
    setAccountsRowVisible(false);
    initializeOptionsToggle();
    loadFragment(
        "mobileProfile",
        $(".post-section"),
        "/profile/" + userId,
        '<div class="loader-wrapper"><span class="loader"></span></div>'
    );
    showPosts(1, userId);
}

function showHome() {
    setMoreMenuVisible(false);
    setAccountsRowVisible(true);
    showComposer();
    showPosts(0, 0);
}

function showLikedPosts() {
    resetOverlay();
    setMoreMenuVisible(false);
    setActiveTab("More");
    setAccountsRowVisible(false);
    $(".post-section").html('<div class="mobile-more-title"><h4>Liked post</h4></div>');
    showPosts(3, getCurrentUserId());
}


function validatePostFeatures(content, mentionsData) {

    // Detect mentions like @coreXmanzoid
    const mentionMatches = content.match(/@\w+/g) || [];

    // Detect hashtags like #ChatFlick
    const hashtagMatches = content.match(/#\w+/g) || [];

    // Check hashtag limit
    if (hashtagMatches.length > 5) {

        showMobileToast(
            "Free users can only use up to 5 hashtags per post.",
            "Notice"
        );

        return false;
    }

    // Check plain text mentions for free users
    if (mentionMatches.length > 0 && (!mentionsData || mentionsData.length === 0)) {

        showMobileToast(
            "Upgrade to ChatFlick Pro to use mentions in posts.",
            "Notice"
        );

        return false;
    }

    return true;
}

function exploreAccounts(url) {
    mobileFeedState.active = false;
    $("#feed-post").html('<div class="loader-wrapper"><span class="loader"></span></div>');

    ajaxWithAbort("mobileExploreAccounts", {
        url: url,
        method: "GET",
        success: function (response) {
            injectHtmlResponse($("#feed-post"), response);
        }
    });
}

function showSearch() {
    resetOverlay();
    setActiveTab("Search");
    setMoreMenuVisible(false);
    setAccountsRowVisible(false);
    $(".post-section").html(
        '<div class="search">' +
        '<i class="bi bi-search"></i>' +
        '<input type="text" placeholder="Search By Name" autocomplete="off">' +
        "</div>"
    );
    exploreAccounts("/exploreAccounts/0/random");
    $(".search input").trigger("focus");
}

function showNotifications() {
    resetOverlay();
    mobileFeedState.active = false;
    setActiveTab("Search");
    setMoreMenuVisible(false);
    setAccountsRowVisible(false);
    $("#feed-post").empty();
    loadFragment(
        "mobileNotifications",
        $(".post-section"),
        "/notifications",
        '<div class="loader-wrapper"><span class="loader"></span></div>'
    ).done(function () {
        markAsRead();
    });
}

function showAi() {
    resetOverlay();
    mobileFeedState.active = false;
    setActiveTab("AI");
    setMoreMenuVisible(false);
    setAccountsRowVisible(false);
    $("#feed-post").empty();
    $(".post-section").html(
        '<div class="Manzoid-container">' +
        '<div class="main-content">' +
        '<div class="ai-header"><img src="/static/assets/logo.png" alt="">FlickAI</div>' +
        '<div id="chat-box" class="chat-box">' +
        "<div class=\"message ai\">Welcome! I'm FlickAI. How can I help you today?</div>" +
        "</div>" +
        '<div class="chat-input">' +
        '<input type="text" id="user-input" autocomplete="off" maxlength="100" placeholder="write a motivation tweet...">' +
        '<button type="button" id="send-ai-message">Send</button>' +
        "</div>" +
        "</div>" +
        "</div>"
    );
}

function renderMobileRoute(route) {
    if (route.name === "home") {
        showHome();
        return;
    }

    if (route.name === "profile") {
        showProfile(route.id);
        return;
    }

    if (route.name === "search") {
        showSearch();
        return;
    }

    if (route.name === "notifications") {
        showNotifications();
        return;
    }

    if (route.name === "ai") {
        showAi();
        return;
    }

    if (route.name === "liked") {
        showLikedPosts();
        return;
    }

    if (route.name === "post") {
        showHome();
        openFullPostById(route.id);
    }
}

function markAsRead() {
    const userId = $(".notifications").data("userid") || getCurrentUserId();

    if (!userId) {
        return;
    }

    ajaxWithAbort("mobileMarkAsRead", {
        url: "/notifications/mark_read/" + userId,
        success: function () {
            checkForNotifications(userId);
            $(".notifications .badge").remove();
        }
    });
}

function checkForNotifications(id) {
    if (!id) {
        return;
    }

    ajaxWithAbort("mobileCheckNotifications", {
        url: "/check-notifications/" + id,
        method: "GET",
        success: function (response) {
            const $icon = $("#notification-icon");
            $icon.find(".notification-dot").remove();

            if (response.unread_count > 0) {
                $icon.css("position", "relative").append(
                    '<span class="notification-dot translate-middle badge rounded-circle p-1"></span>'
                );
            }
        }
    });
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
    const profileImg = $(".newPost img").attr("src") || "/static/assets/default-profile.jpg";
    const tempId = "temp-" + Date.now();
    const timestamp = new Date().toISOString();
    const postHtml =
        '<div class="post info p-1" data-postid="' + tempId + '">' +
        '<div class="post-heading">' +
        '<img src="' + profileImg + '" alt="" width="40" height="40" class="rounded-circle me-2">' +
        '<h5 data-userid="' + userId + '">Posting<br><span>@you</span></h5>' +
        '<small class="post-time" data-timestamp="' + timestamp + '">Just now</small>' +
        '<div class="edit-post ms-auto me-2" title="Edit Post">Posting...</div>' +
        "</div>" +
        '<div class="post-content"><p class="content" data-mentions="[]"></p><p class="hashtag"></p></div>' +
        '<div class="post-actions">' +
        '<a class="comment"><i class="bi bi-chat-heart"></i> 0</a>' +
        '<a class="retweet"><i class="bi bi-repeat"></i> 0</a>' +
        '<a class="like"><i class="bi bi-heart"></i> 0</a>' +
        '<a class="share"><i class="bi bi-share"></i> 0</a>' +
        "</div><hr></div>";

    $("#feed-post").prepend(postHtml);
    $("#feed-post .post").first().find(".post-content .content").text(content);
    initializeDynamicContent($("#feed-post"));
    return tempId;
}

function getEditPostIconHtml() {
    return `
        <svg style="width: 22px; cursor:pointer" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640">
            <path d="M505 122.9L517.1 135C526.5 144.4 526.5 159.6 517.1 168.9L488 198.1L441.9 152L471 122.9C480.4 113.5 495.6 113.5 504.9 122.9zM273.8 320.2L408 185.9L454.1 232L319.8 366.2C316.9 369.1 313.3 371.2 309.4 372.3L250.9 389L267.6 330.5C268.7 326.6 270.8 323 273.7 320.1zM437.1 89L239.8 286.2C231.1 294.9 224.8 305.6 221.5 317.3L192.9 417.3C190.5 425.7 192.8 434.7 199 440.9C205.2 447.1 214.2 449.4 222.6 447L322.6 418.4C334.4 415 345.1 408.7 353.7 400.1L551 202.9C579.1 174.8 579.1 129.2 551 101.1L538.9 89C510.8 60.9 465.2 60.9 437.1 89zM152 128C103.4 128 64 167.4 64 216L64 488C64 536.6 103.4 576 152 576L424 576C472.6 576 512 536.6 512 488L512 376C512 362.7 501.3 352 488 352C474.7 352 464 362.7 464 376L464 488C464 510.1 446.1 528 424 528L152 528C129.9 528 112 510.1 112 488L112 216C112 193.9 129.9 176 152 176L264 176C277.3 176 288 165.3 288 152C288 138.7 277.3 128 264 128L152 128z"/>
        </svg>
    `;
}
function createPostContentElement(content, mentions) {
    return $("<p></p>")
        .addClass("content")
        .attr("data-mentions", mentions || "[]")
        .text(content || "");
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
                $(".newPost img").attr("src", res.image_url);
            }
        },
        error: function (err) {
            console.error(err.responseJSON || err);
        }
    });
}

function appendNewComment(name, username, content, profileImageUrl, userId) {
    const commentId = "new-" + Date.now();
    const commentHtml =
        '<div class="post-top">' +
        '<div class="post-heading">' +
        '<img src="' + profileImageUrl + '" alt="" width="30" height="30" class="rounded-circle me-2">' +
        '<h5 data-userid="' + userId + '">' + name + " <br><span>@" + username + "</span></h5>" +
        "</div>" +
        '<div class="post-actions comment-actions" data-commentId="' + commentId + '">' +
        '<a class="like-comment"><i class="bi bi-heart"></i> 0</a>' +
        "</div></div>" +
        '<div class="post-content comment-content"><p class="content" data-mentions="[]"></p></div><hr>';

    $(".all-comments .no-data").remove();
    $(".all-comments").prepend(commentHtml);
    $(".all-comments .comment-content .content").first().text(content);
    return $(".all-comments .post-top").first();
}

function submitComment() {
    const postId = $(".fullpost-box .post-detail").data("postid");
    const postUserId = $(".fullpost-box .post-detail .post-heading h5").data("userid");
    const postContent = $(".my-comment input").val().trim();
    const currentUserName = $("#submitComment").data("current_user_name");
    const currentUserUsername = $("#submitComment").data("current_user_username");
    const currentUserProfileImage = $(".my-comment img").attr("src");
    const currentUserId = getCurrentUserId();
    let comments = (parseInt($(".comments span").text(), 10) || 0) + 1;

    if (!postContent || !postId) {
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
        success: function (response) {
            comments = response.comments_count || comments;
            $(".comments span").text(comments);
            $('.post[data-postid="' + postId + '"] .comment').each(function () {
                setActionCount($(this), comments);
            });
            $newComment.next(".comment-content").find(".content").attr("data-mentions", JSON.stringify(response.mentions || []));
            initializeDynamicContent($(".fullpost-box"));

            sendNotification({
                recipientId: postUserId,
                title: "New Comment",
                type: "new_comment",
                identifier: postId,
                message: currentUserName + " commented on your post.",
                state: 3
            });

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
        error: function () {
            $newComment.next(".comment-content").next("hr").remove();
            $newComment.next(".comment-content").remove();
            $newComment.remove();
            $(".comments span").text(Math.max(comments - 1, 0));
            showMobileToast("Failed to submit comment. Please try again.", "error");
        },
        complete: function () {
            $("#submitComment").prop("disabled", false);
        }
    });
    let commentMentions = parseMentions($newComment.next(".comment-content").find(".content").data("mentions"));
    validatePostFeatures(postContent, commentMentions);
}

function openFullPostById(postId) {
    if (!postId || String(postId).indexOf("temp-") === 0) {
        return;
    }

    $(".post").removeClass("active-post");
    $('.post[data-postid="' + postId + '"]').addClass("active-post");
    $(".fullpost-overlay").prop("hidden", false);
    $("body").css("overflow", "hidden");

    loadFragment(
        "mobileComments",
        $(".fullpost-box"),
        "/FullPost/" + postId,
        '<div class="loader-wrapper"><span class="loader"></span></div>'
    );
}

function showFullPost(e) {
    if (e) {
        e.preventDefault();
    }

    const postId = $(this).closest(".post").data("postid");

    if (!postId || String(postId).indexOf("temp-") === 0) {
        return;
    }

    ChatFlickMobileNav.navigate("/post/" + postId);
}

function addMessage(text, sender) {
    const $chatBox = $("#chat-box");
    const $msg = $("<div></div>").addClass("message " + sender).text(text);

    $chatBox.append($msg);
    $chatBox.scrollTop($chatBox[0].scrollHeight);
}

function sendMessage() {
    const $input = $("#user-input");
    const text = $input.val().trim();
    const userId = getCurrentUserId();

    if (!text || !userId) {
        return;
    }

    addMessage(text, "user");
    $input.val("");

    const $typing = $('<div class="message ai typing-indicator"><span></span><span></span><span></span></div>');
    $("#chat-box").append($typing);

    $.ajax({
        url: "/Manzoid-AI",
        type: "POST",
        contentType: "application/json",
        data: JSON.stringify({
            message: text,
            user_id: userId
        }),
        success: function (data) {
            $typing.remove();
            addMessage(data.reply || "AI service error.", "ai");
        },
        error: function () {
            $typing.remove();
            addMessage("Network error.", "ai");
        }
    });
}

$(function () {
    ChatFlickMobileNav.start();
    $(window).on("scroll.mobileFeedInfinite", maybeLoadMorePosts);
    $(".feed-preview").on("scroll.mobileFeedInfinite", maybeLoadMorePosts);

    $(document).on("click", ".navigation .list a", function (e) {
        e.preventDefault();
        const label = $(this).find(".text").text().trim();

        if (label === "Home") {
            ChatFlickMobileNav.navigate("/mobile-home");
        } else if (label === "Search") {
            ChatFlickMobileNav.navigate("/explore");
        } else if (label === "More") {
            toggleMoreMenu();
        } else if (label === "FlickAI") {
            ChatFlickMobileNav.navigate("/Manzoid-AI");
        } else if (label === "Profile") {
            ChatFlickMobileNav.navigate("/profile/" + getCurrentUserId());
        }
    });

    $(document).on("click", function (e) {
        if (!$(e.target).closest(".more-menu-overlay, .navigation .list").length) {
            setMoreMenuVisible(false);
        }
    });

    $(document).on("click", ".more-menu-overlay", function (e) {
        e.stopPropagation();
    });

    $(document).on("click", ".more-menu-item[data-more-action='liked']", function () {
        ChatFlickMobileNav.navigate("/liked");
    });

    $(document).on("click", ".more-menu-item[data-more-action='switch']", function () {
        if (confirm("Are you sure you want to switch accounts? Unsaved changes will be lost.")) {
            window.location.href = "/logout/2";
        } else {
            setMoreMenuVisible(false);
        }
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
            ChatFlickMobileNav.navigate(path);
        }
    });

    $(document).on("click", ".options-menu a", async function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $link = $(this);
        const clickID = $link.attr("id");

        const userId =
            $(".info").data("user-id") ||
            getCurrentUserId();

        const username =
            $(".info h5 b").text() ||
            "ChatFlick User";

        const profileUrl = window.location.href;

        if (clickID === "notification-settings") {
            window.location.href = $link.attr("href");
            return;
        }

        document.querySelectorAll(".options-menu.show").forEach(function (menu) {
            menu.classList.remove("show");
        });

        /* ==========================
           Notification menu actions
           ========================== */

        if ($link.closest(".notification-options").length) {

            if (clickID === "mark-notifications-read") {

                markAsRead();
                showMobileToast("Notifications marked as read.", "success");

            } else if (clickID === "clear-notifications") {

                $.ajax({
                    url: "/notifications/clear",
                    type: "POST",
                    success: function () {
                        showNotifications();
                        checkForNotifications(getCurrentUserId());
                        showMobileToast("Notifications cleared.", "success");
                    },
                    error: function () {
                        showMobileToast("Unable to clear notifications right now.", "error");
                    }
                });

            } else if (clickID === "refresh-notifications") {

                showNotifications();

            }

            return;
        }

        /* ==========================
           Post actions
           ========================== */

        if (clickID === "report-post") {

            const postId =
                $link.closest(".options-menu").data("postid") ||
                $link.closest(".post, .post-detail").data("postid") ||
                $(".fullpost-box .post-detail").data("postid");

            openMobileReport(postId);

        } else if (clickID === "follow-me") {

            showMobileToast("This feature is coming soon!", "info");

        } else if (clickID === "add-to-favorites") {

            showMobileToast("This feature is coming soon!", "info");

        } else if (clickID === "interested-in-post") {

            showMobileToast("You'll see more posts like this!", "success");

        } else if (clickID === "not-interested-in-post") {

            showMobileToast("You'll see less posts like this!", "success");

        } else if (clickID === "copy-link") {

            const postId =
                $link.closest(".options-menu").data("postid") ||
                $link.closest(".post, .post-detail").data("postid") ||
                $(".fullpost-box .post-detail").data("postid");

            if (postId) {

                const permalink = getPostPermalink(postId);

                if (navigator.clipboard && window.isSecureContext) {

                    try {
                        await navigator.clipboard.writeText(permalink);
                        showMobileToast("Post link copied to clipboard.", "success");
                    } catch (err) {
                        window.prompt("Copy post link", permalink);
                    }

                } else {

                    window.prompt("Copy post link", permalink);

                }
            }

        } else if (clickID === "block-user") {

            showMobileToast("This feature is coming soon!", "info");

        }

        /* ==========================
           Profile actions
           ========================== */

        else if (clickID === "about-this-account") {

            showMobileToast("This feature is coming soon!", "info");

        } else if (clickID === "copy-profile-link") {

            if (navigator.clipboard && window.isSecureContext) {

                try {
                    await navigator.clipboard.writeText(profileUrl);
                    showMobileToast("Profile link copied to clipboard.", "success");
                } catch (err) {
                    showMobileToast("Unable to copy profile link.", "error");
                }

            } else {

                window.prompt("Copy profile link", profileUrl);

            }

        } else if (clickID === "report-user") {

            $(".report-center")
                .data("userid", userId)
                .show();

        } else if (clickID === "share-profile") {

            const shareData = {
                title: `${username}'s ChatFlick Profile`,
                text: [
                    `User: ${username}`,
                    "Check out this profile on ChatFlick"
                ].join("\n"),
                url: profileUrl
            };

            try {

                if (navigator.share) {

                    await navigator.share(shareData);

                } else if (navigator.clipboard && window.isSecureContext) {

                    await navigator.clipboard.writeText(profileUrl);
                    showMobileToast("Profile link copied for sharing.", "success");

                } else {

                    window.prompt("Share profile", profileUrl);

                }

            } catch (err) {

                console.log("Profile share cancelled.");

            }
        }
    });
    $(document).on("click", ".mobile-report-close", function (e) {
        e.preventDefault();
        closeMobileReport();
    });

    $(document).on("click", "#mobileReportOverlay", function (e) {
        if (e.target === this) {
            closeMobileReport();
        }
    });

    $(document).on("click", "#mobileReportSubmit", function (e) {
        e.preventDefault();
        submitMobileReport();
    });

    $("#notification-icon").on("click", function () {
        ChatFlickMobileNav.navigate("/notifications");
    });

    $(document).on("click", "#verifyBtn", function () {
        const userId = getCurrentUserId();
        const $button = $(this);

        $button.prop("disabled", true);
        $button.html('<span class="btn-loader"></span>Sending...');

        ajaxWithAbort("mobileEmailVerification", {
            url: "/email-verification",
            method: "POST",
            data: JSON.stringify({ user_id: userId }),
            contentType: "application/json",
            success: function (response) {
                if (response.status === "success") {
                    $button.html('<span class="btn-loader"></span>Verification in progress...');
                    if ($("#verification-status").length === 0) {
                        $button.after('<strong id="verification-status" class="verification-tag">Verification email sent! Please check your inbox.</strong>');
                    }
                } else {
                    $button.prop("disabled", false).text("Send Verification Email");
                    showMobileToast("Failed to send verification email. Please try again.", "error");
                }
            },
            error: function () {
                $button.prop("disabled", false).text("Send Verification Email");
            }
        });
    });

    $(document).on("click", ".notification-header .bi-arrow-left, .backtohome", function (e) {
        e.preventDefault();
        showHome();
    });

    $(document).on("input", ".search input", function () {
        const query = $(this).val().trim();
        exploreAccounts(query ? "/exploreAccounts/0/" + encodeURIComponent(query) : "/exploreAccounts/0/random");
    });

    $(document).on("click", ".follow-list-close", function () {
        closeFollowListOverlay();
    });

    $(document).on("click", "#followListOverlay", function (e) {
        if (e.target === this) {
            closeFollowListOverlay();
        }
    });

    $(document).on("input", "#followListSearch", function () {
        filterFollowListAccounts($(this).val());
    });

    $(document).on("keydown", function (e) {
        if (e.key === "Escape" && !$("#followListOverlay").prop("hidden")) {
            closeFollowListOverlay();
        }
    });

    $(document).on("click", "#followListOverlay .post-heading", function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();

        const accountId = $(this).find("h5").data("accountid");
        if (accountId) {
            ChatFlickMobileNav.navigate("/profile/" + accountId);
        }
    });

    $(document).on("click", ".top-pages h6", function (e) {
        e.preventDefault();
        $(".top-pages h6").removeClass("active-a");
        $(this).addClass("active-a");
        showPosts(parseInt($(this).data("state"), 10), $(this).data("userid"));
    });

    $(document).on("input", "textarea[name='post-input']", function () {
        updateComposerState($(this));
    });

    $(document).on("click", ".submit button", function () {
        const $button = $(this);
        const $textarea = $("textarea[name='post-input']");
        const content = $textarea.val().trim();
        const userId = $button.data("userid");

        if (!content) {
            updateComposerState($textarea);
            return;
        }

        $textarea.val("");
        updateComposerState($textarea);
        $button.prop("disabled", true);

        const tempPostId = prependPost(content, userId);

        ajaxWithAbort("mobileSubmitPost", {
            url: "/managePosts/1",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({ content: content, user_id: userId }),
            success: function (response) {
                if (response.status !== "success") {
                    $('#feed-post .post[data-postid="' + tempPostId + '"]').remove();
                    showMobileToast("Failed to post. Please try again.", "error");
                    return;
                } else {

                    const $newPost = $('#feed-post .post[data-postid="' + tempPostId + '"]');
                    $newPost.attr("data-postid", response.post_id);
                    $newPost.find(".post-content .hashtag").text(response.hashtags);
                    $newPost.find(".post-content .content").attr("data-mentions", JSON.stringify(response.mentions || []));
                    $newPost.find(".post-time").attr("data-timestamp", response.timestamp).text("Just now");
                    $newPost.find(".edit-post").attr("title", "Edit Post").html(getEditPostIconHtml());
                    initializeDynamicContent($("#feed-post"));

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
                }
            },
            error: function () {
                $('#feed-post .post[data-postid="' + tempPostId + '"]').remove();
                showMobileToast("An error occurred. Please try again.", "error");
            }
        });
        const mentionsData = JSON.parse($textarea.attr("data-mentions") || "[]");
        validatePostFeatures(content, mentionsData);
    });

    $(document).on("click", ".ProfileOptions h6", function () {
        $(".ProfileOptions h6").removeClass("active-a");
        $(this).addClass("active-a");

        const option = $(this).text().trim();
        const userId = $(".ProfileOptions").attr("class").split(" ")[1] || getCurrentUserId();

        if (option === "Posts") {
            showPosts(1, userId);
        } else if (option === "Likes") {
            showPosts(3, userId);
        } else if (option === "Reposts") {
            showPosts(4, userId);
        } else if (option === "About") {
            loadFragment(
                "profileAbout",
                $("#feed-post"),
                "/profile/" + userId + "/about",
                '<div class="page-loader page-loader--profile"><span class="loader2"></span></div>'
            );
        }
    });

    $(document).on("click", ".post-heading h5", function () {
        const profileId = $(this).data("userid") || $(this).data("accountid");
        if (profileId) {
            ChatFlickMobileNav.navigate("/profile/" + profileId);
        }
    });

    $(document).on("click", ".edit-post", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $editLink = $(this);
        const $post = $editLink.closest(".post");
        const postId = $post.data("postid");
        const $content = $post.find(".post-content .content").first();
        const originalContent = $content.text().trim();
        const originalMentions = $content.attr("data-mentions") || "[]";

        if (!postId || String(postId).indexOf("temp-") === 0 || $post.data("editing")) {
            return;
        }

        $post.data("editing", true);

        const $textarea = $('<textarea class="form-control mobile-edit-post" maxlength="180" rows="3"></textarea>')
            .val(originalContent);
        const $deleteBtn = $('<small class="edit-action delete"><u>Delete</u></small>');
        const $saveBtn = $('<small class="edit-action save"><u>Save</u></small>');
        const $cancelBtn = $('<small class="edit-action cancel"><u>Cancel</u></small>');
        const $btnContainer = $('<div class="edit-btn-container m-1" style="display:flex; justify-content:space-between;"></div>');

        $content.replaceWith($textarea);
        $btnContainer.append($deleteBtn, $cancelBtn, $saveBtn);
        $post.find(".post-content").after($btnContainer);
        $editLink.hide();
        $textarea.trigger("focus");

        function closeEditor(content, mentions) {
            $textarea.replaceWith(createPostContentElement(content, mentions || originalMentions));
            $btnContainer.remove();
            $editLink.show();
            $post.data("editing", false);
            initializeDynamicContent($post);
        }

        $saveBtn.on("click", function (event) {
            event.preventDefault();
            event.stopPropagation();

            const nextContent = $textarea.val().trim();
            if (!nextContent) {
                showMobileToast("Post content cannot be empty.", "error");
                return;
            }

            if (!confirm("Do you want to update your post? This action cannot be undone.")) {
                return;
            }

            $saveBtn.css("pointer-events", "none");

            $.ajax({
                url: "/managePosts/2",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({
                    post_id: postId,
                    content: nextContent
                }),
                success: function (res) {
                    if (res.status !== "success") {
                        showMobileToast(res.status || "Unable to update post.", "error");
                        return;
                    }

                    closeEditor(res.content || nextContent, originalMentions);
                },
                error: function () {
                    showMobileToast("Failed to update post. Please try again.", "error");
                },
                complete: function () {
                    $saveBtn.css("pointer-events", "");
                }
            });
        });

        $cancelBtn.on("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            closeEditor(originalContent, originalMentions);
        });

        $deleteBtn.on("click", function (event) {
            event.preventDefault();
            event.stopPropagation();

            if (!confirm("Are you sure you want to delete this post? This action cannot be undone.")) {
                return;
            }

            $deleteBtn.css("pointer-events", "none");

            $.ajax({
                url: "/managePosts/3",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({ post_id: postId }),
                success: function (res) {
                    if (res.status !== "success") {
                        showMobileToast(res.status || "Unable to delete post.", "error");
                        return;
                    }

                    $('.post[data-postid="' + postId + '"]').remove();
                },
                error: function () {
                    showMobileToast("Failed to delete post. Please try again.", "error");
                },
                complete: function () {
                    $deleteBtn.css("pointer-events", "");
                }
            });
        });
    });

    $(document).on("click", ".accounts-row .account", function () {
        const profileId = $(this).data("accountid");
        if (profileId) {
            ChatFlickMobileNav.navigate("/profile/" + profileId);
        }
    });

    $(document).on("click", ".full-account .follow button", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $button = $(this);
        const accountId = $button.closest(".full-account").find("h5").data("accountid");
        const isFollowing = $button.text().trim() === "Following";

        $button.text(isFollowing ? "Follow" : "Following");

        $.ajax({
            url: "/follows/" + accountId + "/" + (isFollowing ? "2" : "1"),
            type: "POST",
            success: function (response) {
                if (!isFollowing) {
                    sendNotification({
                        recipientId: accountId,
                        title: "New Follower",
                        type: "new_follower",
                        identifier: response.follower_id,
                        message: response.follower_name + " started following you.",
                        Push: "true",
                        state: 3
                    });
                }
            },
            error: function () {
                $button.text(isFollowing ? "Following" : "Follow");
            }
        });
    });

    $(document).on("click", ".profile .audience small", function (e) {
        e.preventDefault();
        e.stopPropagation();

        const $button = $(this);
        const accountId = $button.parent().attr("class").split(" ")[1];
        const primaryClass = $button.attr("class").split(" ")[0];

        if (primaryClass === "Follow") {
            $.ajax({
                url: "/follows/" + accountId + "/1",
                type: "POST",
                success: function (response) {
                    $button.text("Following");
                    $button.attr("class", "Following ps-3");

                    sendNotification({
                        recipientId: accountId,
                        title: "New Follower",
                        type: "new_follower",
                        identifier: response.follower_id,
                        message: response.follower_name + " started following you.",
                        Push: "true",
                        state: 3
                    });
                }
            });
            return;
        }

        if (primaryClass === "Following") {
            $.ajax({
                url: "/follows/" + accountId + "/2",
                type: "POST",
                success: function () {
                    $button.text("Follow");
                    $button.attr("class", "Follow ps-4");
                }
            });
            return;
        }

        window.location.href = "/setting";
    });

    $(document).on("click", ".profile-pic-wrapper", function () {
        $(this).find("#profileInput").trigger("click");
    });

    $(document).on("change", "#profileInput", function () {
        const userId = $(this).closest(".info").data("user-id");
        if (confirm("Are you sure you want to update your profile picture?")) {
            uploadProfileImage(this, "/update-profile/" + userId);
        } else {
            this.value = "";
        }
    });

    $(document).on("click", ".followers", function () {
        openFollowListOverlay(getAudienceAccountId($(this)), "followers");
    });

    $(document).on("click", ".following", function () {
        openFollowListOverlay(getAudienceAccountId($(this)), "following");
    });

    $(document).on("dblclick", ".post", showFullPost);
    $(document).on("click", ".comment", showFullPost);
    $(document).on("click", ".back-post > i", resetOverlay);
    $(document).on("click", "#submitComment", submitComment);
    $(document).on("keydown", ".my-comment input", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            submitComment();
        }
    });

    $(document).on("click", ".like, .likes", function (e) {
        e.preventDefault();

        const $btn = $(this);
        if ($btn.data("loading")) {
            return;
        }

        $btn.data("loading", true);
        const $icon = $btn.find("i");
        const postId = $btn.closest(".post, .post-detail").data("postid");
        const wasLiked = $btn.hasClass("text-warning") || $icon.hasClass("bi-heart-fill");
        const textNode = $btn.find("span").length ? null : getTextNode($btn);
        const count = parseInt($btn.find("span").text() || textNode.text().trim(), 10) || 0;

        $btn.toggleClass("text-warning", !wasLiked);
        $icon.toggleClass("bi-heart-fill", !wasLiked).toggleClass("bi-heart", wasLiked);
        setActionCount($btn, wasLiked ? count - 1 : count + 1);

        $.ajax({
            url: "/PostAction/1",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({ post_id: postId, like: !wasLiked }),
            success: function (res) {
                setActionCount($btn, res.likes);
            },
            error: function () {
                $btn.toggleClass("text-warning", wasLiked);
                $icon.toggleClass("bi-heart-fill", wasLiked).toggleClass("bi-heart", !wasLiked);
                setActionCount($btn, count);
            },
            complete: function () {
                $btn.data("loading", false);
            }
        });
    });

    $(document).on("click", ".retweet, .retweets", function (e) {
        e.preventDefault();

        const $btn = $(this);
        if ($btn.data("loading")) {
            return;
        }

        $btn.data("loading", true);
        const $icon = $btn.find("i");
        const postId = $btn.closest(".post, .post-detail").data("postid");
        const wasReposted = $btn.hasClass("text-warning");
        const textNode = $btn.find("span").length ? null : getTextNode($btn);
        const count = parseInt($btn.find("span").text() || textNode.text().trim(), 10) || 0;

        $btn.toggleClass("text-warning", !wasReposted);
        setActionCount($btn, wasReposted ? count - 1 : count + 1);
        $icon.removeClass("rotate");
        void $icon[0].offsetWidth;
        $icon.addClass("rotate");

        $.ajax({
            url: "/PostAction/2",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({ post_id: postId, repost: !wasReposted }),
            success: function (res) {
                setActionCount($btn, res.reposts);
            },
            error: function () {
                $btn.toggleClass("text-warning", wasReposted);
                setActionCount($btn, count);
            },
            complete: function () {
                $btn.data("loading", false);
            }
        });
    });

    $(document).on("click", ".share, .shares", function (e) {
        e.preventDefault();

        const $btn = $(this);
        const $container = $btn.closest(".post, .post-detail");
        const postId = $container.data("postid");
        const text = $container.find(".post-content .content").first().text().trim();
        const username = $container.find(".post-heading h5 span").first().text().trim().replace(/^@/, "");
        const url = getPostPermalink(postId);
        const shareData = {
            title: "ChatFlick Post",
            text: buildShareText(username, text),
            url: url
        };

        let shareDone;

        if (navigator.share) {
            shareDone = navigator.share(shareData);
        } else if (navigator.clipboard && window.isSecureContext) {
            shareDone = navigator.clipboard.writeText(shareData.text).then(function () {
                showMobileToast("Post copied to clipboard.", "success");
            });
        } else {
            shareDone = Promise.reject(new Error("Sharing is not available"));
        }

        shareDone.then(function () {
            $.ajax({
                url: "/PostAction/4",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({ post_id: postId }),
                success: function (res) {
                    if (typeof res.shares === "number") {
                        setActionCount($btn, res.shares);
                    }
                }
            });
        }).catch(function (err) {
            if (!err || err.name !== "AbortError") {
                console.error("Share failed:", err);
            }
        });
    });

    $(document).on("click", ".like-comment", function (e) {
        e.preventDefault();

        const $btn = $(this);
        const $icon = $btn.find("i");
        const textNode = getTextNode($btn);
        const likes = parseInt(textNode.text().trim(), 10) || 0;
        const wasLiked = $icon.hasClass("bi-heart-fill");
        const postId = $btn.closest(".comment-actions").data("commentid");

        $btn.toggleClass("text-warning", !wasLiked);
        $icon.toggleClass("bi-heart-fill", !wasLiked).toggleClass("bi-heart", wasLiked);
        textNode[0].nodeValue = " " + (wasLiked ? likes - 1 : likes + 1);

        $.ajax({
            url: "/PostAction/3",
            method: "POST",
            contentType: "application/json",
            data: JSON.stringify({ post_id: postId, like: !wasLiked }),
            success: function (res) {
                textNode[0].nodeValue = " " + res.likes;
            },
            error: function () {
                $btn.toggleClass("text-warning", wasLiked);
                $icon.toggleClass("bi-heart-fill", wasLiked).toggleClass("bi-heart", !wasLiked);
                textNode[0].nodeValue = " " + likes;
            }
        });
    });

    $(document).on("click", "#send-ai-message", sendMessage);
    $(document).on("keydown", "#user-input", function (e) {
        if (e.key === "Enter") {
            e.preventDefault();
            sendMessage();
        }
    });
});
