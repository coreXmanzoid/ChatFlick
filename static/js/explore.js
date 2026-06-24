(function () {
    const DEFAULT_AVATAR = "/static/assets/default-profile.jpg";
    const initialized = new WeakSet();

    function escapeHtml(value) {
        return String(value || "").replace(/[&<>"']/g, function (char) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;"
            }[char];
        });
    }

    function formatCount(value, label) {
        const count = Number(value || 0);
        return count + " " + label + (count === 1 ? "" : "s");
    }

    function initExplore(root) {
        if (!root || initialized.has(root)) {
            return;
        }
        initialized.add(root);

        const state = {
            page: 0,
            hasMoreAccounts: true,
            loadingAccounts: false,
            searchTimer: null,
            searchController: null,
            trendingLoaded: false
        };

        const els = {
            input: root.querySelector("#cfSearchInput"),
            clear: root.querySelector("#cfSearchClear"),
            discovery: root.querySelector("#cfDiscovery"),
            results: root.querySelector("#cfResults"),
            accounts: root.querySelector("#cfAccountsList"),
            seeMore: root.querySelector("#cfSeeMoreAccounts"),
            hashtags: root.querySelector("#cfHashtagsGrid"),
            topics: root.querySelector("#cfTopicsList"),
            popularPosts: root.querySelector("#cfPopularPosts"),
            recentSection: root.querySelector("#cfRecentSearches"),
            recentList: root.querySelector("#cfRecentList"),
            clearRecent: root.querySelector("#cfClearRecent"),
            resultAccountsSection: root.querySelector("#cfResultAccountsSection"),
            resultAccounts: root.querySelector("#cfResultAccounts"),
            resultPostsSection: root.querySelector("#cfResultPostsSection"),
            resultPosts: root.querySelector("#cfResultPosts"),
            resultPostsLabel: root.querySelector("#cfResultPostsLabel"),
            emptyResults: root.querySelector("#cfEmptyResults"),
            emptyQuery: root.querySelector("#cfEmptyQuery")
        };

        if (!els.input) {
            return;
        }

        const storageKey = "chatflick:recent-searches:" + (root.dataset.userid || "guest");

        function recentSearches() {
            try {
                return JSON.parse(localStorage.getItem(storageKey) || "[]");
            } catch (error) {
                return [];
            }
        }

        function renderRecentSearches() {
            const searches = recentSearches().slice(0, 6);
            els.recentSection.hidden = searches.length === 0 || els.input.value.trim() !== "";
            els.recentList.innerHTML = searches.map(function (query) {
                const icon = query.trim().startsWith("#") ? "bi-hash" : "bi-clock-history";
                return (
                    '<button class="cf-recent-chip" type="button" data-query="' + escapeHtml(query) + '">' +
                    '<i class="bi ' + icon + '"></i>' +
                    '<span>' + escapeHtml(query) + "</span>" +
                    '<span class="cf-chip-remove" data-remove="' + escapeHtml(query) + '" aria-label="Remove recent search">' +
                    '<i class="bi bi-x"></i>' +
                    "</span></button>"
                );
            }).join("");
        }

        function saveRecentSearch(query) {
            const clean = query.trim();

            if (clean.length < 3) {
                return;
            }

            const next = [clean].concat(
                recentSearches().filter(function (item) {
                    return item.toLowerCase() !== clean.toLowerCase();
                })
            ).slice(0, 8);

            localStorage.setItem(storageKey, JSON.stringify(next));
            renderRecentSearches();
        }

        function accountCard(account) {
            return (
                '<div class="cf-account-card" data-account-id="' + account.id + '">' +
                '<img class="cf-account-avatar" src="' + escapeHtml(account.profile_image_url || DEFAULT_AVATAR) + '" alt="">' +
                '<div class="cf-account-info">' +
                '<div class="cf-account-name">' + escapeHtml(account.name) +
                (account.is_pro ? '<i class="bi bi-patch-check-fill cf-pro-dot"></i>' : "") +
                "</div>" +
                '<div class="cf-account-meta">@' + escapeHtml(account.username) + ' . ' + formatCount(account.follower_count, "Follower") + "</div>" +
                "</div>" +
                '<button class="cf-follow-btn' + (account.is_following ? " is-following" : "") + '" type="button">' +
                (account.is_following ? "Following" : "Follow") +
                "</button></div>"
            );
        }

        function compactPostCard(post) {
            const content = String(post.content || "").slice(0, 220);
            const user = post.user || {};
            return (
                '<article class="cf-post-card" data-post-id="' + post.id + '">' +
                '<div class="cf-post-header">' +
                '<img class="cf-post-avatar" src="' + escapeHtml(user.profile_image_url || DEFAULT_AVATAR) + '" alt="">' +
                '<div>' +
                '<div class="cf-post-author-name">' + escapeHtml(user.name) +
                (user.is_pro ? '<i class="bi bi-patch-check-fill cf-pro-dot"></i>' : "") +
                "</div>" +
                '<div class="cf-post-author-handle">@' + escapeHtml(user.username) + "</div>" +
                "</div></div>" +
                '<div class="cf-post-content">' + escapeHtml(content) + "</div>" +
                '<div class="cf-post-stats">' +
                '<span class="cf-post-stat"><i class="bi bi-heart"></i>' + Number(post.likes || 0) + "</span>" +
                '<span class="cf-post-stat"><i class="bi bi-chat-heart"></i>' + Number(post.comments || 0) + "</span>" +
                '<span class="cf-post-stat"><i class="bi bi-repeat"></i>' + Number(post.reposts || 0) + "</span>" +
                '<span class="cf-post-stat"><i class="bi bi-share"></i>' + Number(post.shares || 0) + "</span>" +
                "</div></article>"
            );
        }

        function mutedRow(message) {
            return '<div class="cf-muted-row">' + escapeHtml(message) + "</div>";
        }

        function loadAccounts() {
            if (state.loadingAccounts || !state.hasMoreAccounts) {
                return;
            }
            state.loadingAccounts = true;
            state.page += 1;
            els.seeMore.classList.add("is-loading");

            fetch("/api/explore/accounts?page=" + state.page + "&per_page=3")
                .then(function (response) { return response.json(); })
                .then(function (data) {
                    const html = (data.accounts || []).map(accountCard).join("");
                    if (state.page === 1) {
                        els.accounts.innerHTML = html || mutedRow("No suggestions yet.");
                    } else if (html) {
                        els.accounts.insertAdjacentHTML("beforeend", html);
                    }
                    state.hasMoreAccounts = Boolean(data.has_more);
                    els.seeMore.hidden = !state.hasMoreAccounts;
                })
                .catch(function () {
                    if (state.page === 1) {
                        els.accounts.innerHTML = mutedRow("Suggestions could not load.");
                    }
                    state.page = Math.max(0, state.page - 1);
                })
                .finally(function () {
                    state.loadingAccounts = false;
                    els.seeMore.classList.remove("is-loading");
                });
        }

        function runHashtagSearch(tag) {
            const clean = tag.trim();
            const query = clean.startsWith("#") ? clean : "#" + clean;
            els.input.value = query;
            runSearch(query);
        }

        function loadTrending() {
            if (state.trendingLoaded) {
                return;
            }
            state.trendingLoaded = true;

            fetch("/api/trending")
                .then(function (response) { return response.json(); })
                .then(function (data) {
                    const tags = data.trending_hashtags || [];
                    els.hashtags.innerHTML = tags.length ? tags.map(function (item) {
                        return (
                            '<button class="cf-hashtag-chip" type="button" data-query="' + escapeHtml(item.tag) + '">' +
                            escapeHtml(item.tag) +
                            '<span class="cf-hashtag-count">' + Number(item.count || 0) + "</span></button>"
                        );
                    }).join("") : mutedRow("No hashtags are trending yet.");

                    const topics = (data.trending_topics || []).slice(0, 3);
                    els.topics.innerHTML = topics.length ? topics.map(function (item, index) {
                        return (
                            '<button class="cf-topic-item" type="button" data-query="' + escapeHtml(item.query || item.title) + '">' +
                            '<span class="cf-topic-rank">' + (index + 1) + "</span>" +
                            '<span class="cf-topic-info"><span class="cf-topic-title">' + escapeHtml(item.title) + "</span>" +
                            '<span class="cf-topic-meta">' + escapeHtml(item.label || "") + "</span></span>" +
                            '<i class="bi bi-chevron-right cf-topic-arrow"></i></button>'
                        );
                    }).join("") : mutedRow("No active topics yet.");

                    const posts = (data.popular_posts || []).slice(0, 3);
                    els.popularPosts.innerHTML = posts.length ? posts.map(compactPostCard).join("") : mutedRow("Popular posts will appear here.");
                })
                .catch(function () {
                    els.hashtags.innerHTML = mutedRow("Trending hashtags could not load.");
                    els.topics.innerHTML = mutedRow("Trending topics could not load.");
                    els.popularPosts.innerHTML = mutedRow("Popular posts could not load.");
                });
        }

        function setMode(query) {
            const isSearching = query.trim() !== "";
            els.discovery.hidden = isSearching;
            els.results.hidden = !isSearching;
            els.clear.hidden = !isSearching;
            renderRecentSearches();
        }

        function renderResults(data, query) {
            const accounts = data.accounts || [];
            const posts = data.posts || [];

            els.resultAccountsSection.hidden = accounts.length === 0;
            els.resultAccounts.innerHTML = accounts.map(accountCard).join("");

            els.resultPostsSection.hidden = posts.length === 0;
            els.resultPostsLabel.textContent = query.trim().startsWith("#") ? "Posts with " + query.trim() : "Posts";
            els.resultPosts.innerHTML = posts.map(compactPostCard).join("");

            const hasResults = accounts.length > 0 || posts.length > 0;
            els.emptyResults.hidden = hasResults;
            els.emptyQuery.textContent = query;
        }

        function runSearch(query) {
            const clean = query.trim();
            setMode(clean);
            if (!clean) {
                return;
            }

            if (state.searchController) {
                state.searchController.abort();
            }
            state.searchController = new AbortController();

            fetch("/api/search?q=" + encodeURIComponent(clean), { signal: state.searchController.signal })
                .then(function (response) { return response.json(); })
                .then(function (data) {
                    renderResults(data, clean);
                    saveRecentSearch(clean);
                })
                .catch(function (error) {
                    if (error.name !== "AbortError") {
                        renderResults({ accounts: [], posts: [] }, clean);
                    }
                });
        }

        function navigateToPost(postId) {
            if (!postId) {
                return;
            }
            if (window.ChatFlickNav && typeof window.ChatFlickNav.navigate === "function") {
                window.ChatFlickNav.navigate("/post/" + postId);
                return;
            }
            if (window.ChatFlickMobileNav && typeof window.ChatFlickMobileNav.navigate === "function") {
                window.ChatFlickMobileNav.navigate("/post/" + postId);
                return;
            }
            window.location.href = "/post/" + postId;
        }

        els.input.addEventListener("input", function () {
            const query = els.input.value;
            window.clearTimeout(state.searchTimer);
            state.searchTimer = window.setTimeout(function () {
                runSearch(query);
            }, 220);
        });

        els.clear.addEventListener("click", function () {
            els.input.value = "";
            setMode("");
            els.input.focus();
        });

        els.seeMore.addEventListener("click", loadAccounts);

        root.addEventListener("click", function (event) {
            const remove = event.target.closest("[data-remove]");
            if (remove) {
                event.stopPropagation();
                const query = remove.dataset.remove;
                localStorage.setItem(storageKey, JSON.stringify(recentSearches().filter(function (item) {
                    return item !== query;
                })));
                renderRecentSearches();
                return;
            }

            const recent = event.target.closest(".cf-recent-chip[data-query]");
            if (recent) {
                els.input.value = recent.dataset.query;
                runSearch(recent.dataset.query);
                return;
            }

            const tag = event.target.closest(".cf-hashtag-chip[data-query], .cf-topic-item[data-query]");
            if (tag) {
                runHashtagSearch(tag.dataset.query);
                return;
            }

            const account = event.target.closest(".cf-account-card");
            if (account && !event.target.closest(".cf-follow-btn")) {
                if (typeof window.showProfile === "function") {
                    window.showProfile(account.dataset.accountId);
                } else {
                    window.location.href = "/profile/" + account.dataset.accountId;
                }
                return;
            }

            const postCard = event.target.closest(".cf-post-card[data-post-id]");
            if (postCard) {
                navigateToPost(postCard.dataset.postId);
            }
        });

        root.addEventListener("click", function (event) {
            const button = event.target.closest(".cf-follow-btn");
            if (!button) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();

            const accountId = button.closest(".cf-account-card").dataset.accountId;
            const isFollowing = button.classList.contains("is-following");
            button.disabled = true;

            fetch("/follows/" + accountId + "/" + (isFollowing ? "2" : "1"), { method: "POST" })
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error("Follow request failed");
                    }
                    button.classList.toggle("is-following", !isFollowing);
                    button.textContent = isFollowing ? "Follow" : "Following";
                })
                .catch(function () {
                    button.textContent = isFollowing ? "Following" : "Follow";
                })
                .finally(function () {
                    button.disabled = false;
                });
        });

        els.clearRecent.addEventListener("click", function () {
            localStorage.removeItem(storageKey);
            renderRecentSearches();
        });

        setMode("");
        renderRecentSearches();
        loadAccounts();
        loadTrending();
    }

    function initAll() {
        document.querySelectorAll(".cf-explore").forEach(initExplore);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAll);
    } else {
        initAll();
    }

    new MutationObserver(initAll).observe(document.documentElement, {
        childList: true,
        subtree: true
    });
})();
