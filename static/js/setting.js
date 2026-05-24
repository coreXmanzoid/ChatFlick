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

function readFlashedMessages() {
    const flashNode = document.getElementById("setting-flash-data");
    if (!flashNode) {
        return [];
    }

    try {
        const parsed = JSON.parse(flashNode.textContent);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        showSettingToast("Unable to read saved notifications.", "error");
        return [];
    }
}

function showFlashedMessages() {
    const messages = readFlashedMessages();
    messages.forEach(([category, message], index) => {
        window.setTimeout(() => {
            showSettingToast(message, category || "info");
        }, index * 140);
    });
}

function getCurrentSettingUserId() {
    return $(".user-account-info p").data("userid");
}

function saveChanges(section, data) {
    $.ajax({
        url: `/setting/${section}`,
        method: "POST",
        data: JSON.stringify(data),
        contentType: "application/json",
        success: function () {
            window.location.reload();
        },
        error: function (err) {
            const message = err?.responseJSON?.message || "Unable to save your changes right now.";
            showSettingToast(message, "error");
        }
    });
}

function uploadProfileImage(input, url, fileOverride) {
    const file = fileOverride || (input && input.files ? input.files[0] : null);

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
                $("#avatar-preview, .profile-pic").attr("src", res.image_url);
                showSettingToast("Profile image updated successfully.", "success");
            }
        },
        error: function (err) {
            console.error(err.responseJSON || err);
            showSettingToast("Failed to update your profile image.", "error");
        }
    });
}

function bindPushNotificationToggle() {
    const pushToggle = document.getElementById("push");
    if (!pushToggle) {
        return;
    }

    pushToggle.addEventListener("change", function () {
        if (!pushToggle.checked) {
            if (typeof window.deleteSavedNotificationToken === "function") {
                window.deleteSavedNotificationToken();
            }
            return;
        }

        const pushIssue = typeof window.getPushSupportIssue === "function" ? window.getPushSupportIssue() : "";
        if (pushIssue) {
            showSettingToast(pushIssue, "error");
            pushToggle.checked = false;
            return;
        }

        if (typeof window.enableNotifications === "function") {
            window.enableNotifications(true);
        }
    });
}

document.addEventListener("DOMContentLoaded", function () {
    let cropper = null;
    let croppedProfileFile = null;

    const uploadBtn = document.getElementById("upload-btn");
    const fileInput = document.getElementById("profile-image");
    const modal = document.getElementById("cropModal");
    const cropImage = document.getElementById("crop-image");
    const avatarPreview = document.getElementById("avatar-preview");
    const cancelBtn = document.getElementById("crop-cancel");
    const confirmBtn = document.getElementById("crop-confirm");
    const settingsMenuToggle = document.querySelector(".settings-menu-toggle");
    const settingsNav = document.getElementById("settings-nav-menu");
    const saveButton = document.querySelector(".save-button");
    const themeSelect = document.getElementById("manage-theme");

    function applyTheme(theme) {
        const activeTheme = theme === "light" ? "light" : "dark";
        document.body.classList.remove("settings-theme-light", "settings-theme-dark");
        document.body.classList.add(`settings-theme-${activeTheme}`);
        document.body.dataset.theme = activeTheme;
    }

    const initialTheme = document.body.dataset.theme || "light";
    applyTheme(initialTheme);
    showFlashedMessages();
    bindPushNotificationToggle();

    if (themeSelect) {
        themeSelect.value = initialTheme;
        themeSelect.addEventListener("change", function () {
            const selectedTheme = themeSelect.value || "dark";
            applyTheme(selectedTheme);
        });
    }

    if (uploadBtn && fileInput && modal && cropImage && avatarPreview && cancelBtn && confirmBtn) {
        uploadBtn.addEventListener("click", function () {
            fileInput.click();
        });

        fileInput.addEventListener("change", function (event) {
            const file = event.target.files[0];
            if (!file) {
                return;
            }

            croppedProfileFile = null;
            const reader = new FileReader();

            reader.onload = function (loadEvent) {
                cropImage.src = loadEvent.target.result;
                modal.style.display = "flex";

                cropImage.onload = function () {
                    if (cropper) {
                        cropper.destroy();
                    }

                    cropper = new Cropper(cropImage, {
                        aspectRatio: 1,
                        viewMode: 1,
                        autoCropArea: 0.9,
                        responsive: true,
                        movable: true,
                        zoomable: true,
                        cropBoxMovable: true,
                        cropBoxResizable: true,
                        ready() {
                            cropper.reset();
                        }
                    });
                };
            };

            reader.readAsDataURL(file);
        });
    }

    document.querySelectorAll(".faq-question").forEach((item) => {
        item.addEventListener("click", function () {
            const parent = item.parentElement;
            document.querySelectorAll(".faq").forEach((faq) => {
                if (faq !== parent) {
                    faq.classList.remove("active");
                }
            });
            parent.classList.toggle("active");
        });
    });

    if (confirmBtn && avatarPreview && modal) {
        confirmBtn.addEventListener("click", function (event) {
            event.preventDefault();
            if (!cropper) {
                return;
            }

            const canvas = cropper.getCroppedCanvas({
                width: 300,
                height: 300
            });

            avatarPreview.src = canvas.toDataURL("image/png");
            canvas.toBlob(function (blob) {
                if (!blob) {
                    return;
                }

                const userId = saveButton ? saveButton.dataset.userid : null;
                croppedProfileFile = new File([blob], "profile.png", { type: "image/png" });

                if (userId) {
                    uploadProfileImage(fileInput, `/update-profile/${userId}`, croppedProfileFile);
                }

                modal.style.display = "none";
                cropper.destroy();
                cropper = null;
            }, "image/png");
        });
    }

    if (cancelBtn && modal) {
        cancelBtn.addEventListener("click", function (event) {
            event.preventDefault();
            modal.style.display = "none";

            if (cropper) {
                cropper.destroy();
                cropper = null;
            }
        });
    }

    if (settingsMenuToggle && settingsNav) {
        settingsMenuToggle.addEventListener("click", function () {
            const isOpen = settingsNav.classList.toggle("is-open");
            settingsMenuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        });

        settingsNav.querySelectorAll("a").forEach((link) => {
            link.addEventListener("click", function () {
                if (window.innerWidth <= 980) {
                    settingsNav.classList.remove("is-open");
                    settingsMenuToggle.setAttribute("aria-expanded", "false");
                }
            });
        });
    }
});

$(".report-section button").click(function () {
    const reportInput = $("#report-input");

    if (reportInput.is(":visible")) {
        const userId = getCurrentSettingUserId();
        const inputText = reportInput.val().trim();

        if (!userId || !inputText) {
            showSettingToast("Please describe the issue before submitting.", "error");
            return;
        }

        $.ajax({
            url: "/setting/create-report",
            type: "POST",
            data: JSON.stringify({
                user_id: userId,
                message: inputText
            }),
            contentType: "application/json",
            success: function () {
                reportInput.val("");
                reportInput.hide();
                window.location.reload();
            },
            error: function (err) {
                const message = err?.responseJSON?.message || "Unable to save your changes right now.";
                showSettingToast(message, "error");
            }
        });
    } else {
        reportInput.show();
        reportInput.focus();
    }
});

$(".faq-badge").click(function () {
    $(".help-center").show();
});

$("#verifyBtn").click(function () {
    const problem = $("#help-center-input").val().trim();
    const category = $("#issue-category").val();
    const userId = getCurrentSettingUserId();
    const $button = $(this);
    const $answer = $("#support-ai-answer");

    if (!userId || !problem) {
        showSettingToast("Please write your support request before submitting.", "error");
        return;
    }

    $button.prop("disabled", true).text("Submitting...");
    $answer.hide().text("");

    $.ajax({
        url: "/setting/create-support-request",
        type: "POST",
        data: JSON.stringify({
            user_id: userId,
            category: category,
            message: problem
        }),
        contentType: "application/json",
        success: function (data) {
            if (data.reply) {
                $answer.text(data.reply).show();
                showSettingToast("Your request was submitted and Manzoid AI drafted an answer.", "success");
            } else {
                showSettingToast("Your request was submitted. Support will respond soon.", "success");
            }
            $("#help-center-input").val("");
        },
        error: function (err) {
            const message = err?.responseJSON?.message || "Unable to save your changes right now.";
            showSettingToast(message, "error");
        },
        complete: function () {
            $button.prop("disabled", false).text("Submit");
        }
    });
});


$(".cancel-button").click(function () {
    window.location.href = "/home";
});

$(document).ready(function () {
    function validate() {
        const value = $("#new_password").val();
        const confirmValue = $("#confirm_password").val();

        $("#length span").text(value.length >= 8 ? "✔️" : "❌");
        $("#number span").text(/\d/.test(value) ? "✔️" : "❌");
        $("#special span").text(/[!@#$%^&*(),.?":{}|<>]/.test(value) ? "✔️" : "❌");
        $("#match span").text(value && value === confirmValue ? "✔️" : "❌");
    }

    $("#new_password, #confirm_password").on("input", validate);
});

$(".verification-overlay small").click(function () {
    $(".verification-overlay").hide();
});

$(document).ready(function () {
    const container = $(".privecy-info");

    function showInfo(target) {
        container.find("p").removeClass("active");

        if (target) {
            container.find(`.${target}`).addClass("active");
        } else {
            container.find(".general").addClass("active");
        }
    }

    $(".toggle").on("mouseenter", function () {
        showInfo($(this).data("info"));
    });

    $(".toggle").on("mouseleave", function () {
        showInfo(null);
    });

    $(".toggle").on("click", function () {
        showInfo($(this).data("info"));
    });

    showInfo(null);
});

$(".danger-area button").click(function () {
    $(".username-verification").show();
    const identification = $(this).attr("id");
    $("#submitBtn").attr("data-state", identification);
});

$("#username-input").keyup(function () {
    const username = $(this).data("target");
    const userEnteredUsername = $(this).val();
    $("#submitBtn").prop("disabled", username !== userEnteredUsername);
});

$("#submitBtn").click(function () {
    const state = $(this).attr("data-state");
    if (!state) {
        return;
    }

    const userId = $(this).closest(".verification-box").find("p").data("id");
    $.ajax({
        url: `/danger-zone/${state}`,
        type: "POST",
        data: JSON.stringify({
            user_id: userId
        }),
        contentType: "application/json",
        success: function () {
            window.location.reload();
        },
        error: function (err) {
            const message = err?.responseJSON?.message || "Unable to complete this action right now.";
            showSettingToast(message, "error");
        }
    });
});

$(".save-button").click(function () {
    const sectionName = $("section").attr("id");
    const userId = $(this).data("userid");
    let data = null;

    if (sectionName === "profile") {
        data = {
            user_id: userId,
            new_name: $("#full_name").val(),
            new_username: $("#username").val(),
            new_contact: $("#number").val(),
            new_bio: $("#bio").val()
        };
        saveChanges("profile-setting", data);
    } else if (sectionName === "account") {
        data = {
            user_id: userId,
            new_email: $("#email").val(),
            new_birthdate: $("#birthday").val(),
            new_website: $("#website").val(),
            new_about: $("#about-info").val()
        };
        saveChanges("account-setting", data);
    } else if (sectionName === "password") {
        const isValid =
            $("#length span").text() === "✔️" &&
            $("#number span").text() === "✔️" &&
            $("#special span").text() === "✔️" &&
            $("#match span").text() === "✔️";

        if (!isValid) {
            showSettingToast("Please complete all password requirements first.", "error");
            return;
        }

        data = {
            user_id: userId,
            current_password: $("#current_password").val(),
            new_password: $("#new_password").val(),
            confirm_password: $("#confirm_password").val()
        };
        saveChanges("password-setting", data);
    } else if (sectionName === "privacy") {
        data = {
            user_id: userId,
            private_account: $("#privacyStatus").is(":checked"),
            birthdate_status: $("#birthdate").is(":checked"),
            bio_status: $("#bio").is(":checked"),
            myStatus: $("#status").is(":checked")
        };
        saveChanges("privacy-settings", data);
    } else if (sectionName === "apps") {
        data = {
            user_id: userId,
            theme: $("#manage-theme").val()
        };
        saveChanges("support-setting", data);
    } else if (sectionName === "notifications") {
        data = {
            user_id: userId,
            push_notifications: $("#push").is(":checked"),
            email_notifications: $("#emailz").is(":checked"),
            mentions: $("#mentionz").is(":checked"),
            reposts: $("#repostz").is(":checked"),
            likes_comments: $("#likeXcomment").is(":checked"),
            new_followers: $("#followerz").is(":checked")
        };
        saveChanges("notifications-settings", data);
    }
});
