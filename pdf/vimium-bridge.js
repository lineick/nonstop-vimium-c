"use strict";

// Vimium-C integration bridge for the PDF viewer.
// Adapts Vimium-C's scroll and mark functions to work with the PDF viewer.
// Since the page URL is the original PDF URL (thanks to filterResponseData),
// Vimium-C's content scripts inject naturally and this bridge just adapts behavior.

(function () {
    var viewer = null; // window.__nonstopViewer
    var api = null; // window.VApi (set by vimium-c)
    var oldScroll = null;

    // --- Bridge setup ---

    function setupBridge() {
        viewer = window.__nonstopViewer;
        api = window.VApi;

        if (!api || typeof api.$ !== "function" || !viewer) return false;

        oldScroll = api.$;

        var container = viewer.container;

        // Override scroll function to work with PDF viewer container
        api.$ = function (element, di, amount) {
            if (Math.abs(amount) < 0.1) {
                return oldScroll.apply(this, arguments);
            }

            if (!container) {
                return oldScroll.apply(this, arguments);
            }

            var topEl = document.fullscreenElement || document.documentElement;
            if (
                element === topEl ||
                element === document.body ||
                element === container ||
                (document.fullscreenElement && !topEl.contains(element))
            ) {
                element = container;
            }

            if (element === container || container.contains(element)) {
                var oldTop = container.scrollTop;
                container.scrollTop += amount;
                return container.scrollTop !== oldTop;
            }

            return oldScroll.apply(this, arguments);
        };

        // Listen for vimium mark events (save/restore position)
        window.addEventListener("vimiumMark", onMark, true);

        return true;
    }

    function onMark(event) {
        var a = event.relatedTarget;
        var str = a && a.textContent;
        var container = viewer && viewer.container;
        event.stopImmediatePropagation();

        if (!container) return;

        if (!str) {
            a.textContent = [container.scrollLeft, container.scrollTop, viewer.currentPage || 1].join(",");
            return;
        }

        var parts = str.split(",");
        var x = parseInt(parts[0], 10) || 0;
        var y = parseInt(parts[1], 10) || 0;
        var page = parseInt(parts[2], 10) || -1;

        if (page >= 1) {
            viewer.currentPage = page;
        }
        if (x || y) {
            container.scrollTo(x, y);
        }
        if (x || y || page >= 1) {
            a.textContent = "";
            event.preventDefault();
        }
    }

    // Poll for VApi (vimium-c's page-world API for scroll/marks override).
    // Not critical — scroll works natively via the focused container.
    var attempts = 0;
    var interval = setInterval(function () {
        if (setupBridge()) {
            clearInterval(interval);
        } else if (++attempts > 300) {
            clearInterval(interval);
        }
    }, 50);

    document.addEventListener("DOMContentLoaded", function () {
        if (!api) setupBridge();
    });
    window.addEventListener("load", function () {
        if (!api) setupBridge();
    });
})();
