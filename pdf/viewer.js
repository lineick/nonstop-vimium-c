"use strict";

(function () {
  var pdfUrl = window.__nonstopPdfUrl;
  var extUrl = window.__nonstopExtUrl;
  if (!pdfUrl || !extUrl) return;

  // Configure PDF.js worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = extUrl + "pdf/lib/pdf.worker.min.js";

  var container = document.getElementById("nonstop-container");
  var viewer = document.getElementById("nonstop-viewer");
  var loadingEl = document.getElementById("nonstop-loading");
  var pageCountEl = document.getElementById("nonstop-page-count");
  var pageInputEl = document.getElementById("nonstop-page-input");
  var zoomSelect = document.getElementById("nonstop-zoom-select");

  var pdfDoc = null;
  var pages = [];         // { div, canvas, textLayer, viewport, rendered, rendering }
  var currentScale = 1;
  var scaleMode = "page-width"; // "page-width", "page-fit", "auto", or numeric
  var containerWidth = 0;
  var containerHeight = 0;
  var observer = null;
  var currentPageNum = 1;

  // Expose for vimium-bridge
  window.__nonstopViewer = {
    get container() { return container; },
    get pdfDoc() { return pdfDoc; },
    get currentPage() { return currentPageNum; },
    set currentPage(num) { goToPage(num); },
    get numPages() { return pdfDoc ? pdfDoc.numPages : 0; },
    get scale() { return currentScale; },
  };

  // --- Load PDF ---

  function loadPdf() {
    var loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      withCredentials: true,
    });

    loadingTask.onPassword = function (updateCallback, reason) {
      showPasswordDialog(reason === 2 ? "Incorrect password. Try again:" : "This PDF is password-protected:", updateCallback);
    };

    loadingTask.promise.then(function (pdf) {
      pdfDoc = pdf;
      pageCountEl.textContent = pdf.numPages;
      loadingEl.classList.add("nonstop-hidden");
      initPages();
      loadOutline();
    }).catch(function (err) {
      loadingEl.textContent = "Failed to load PDF: " + (err.message || err);
    });
  }

  function showPasswordDialog(message, callback) {
    var overlay = document.createElement("div");
    overlay.id = "nonstop-password-overlay";

    var dialog = document.createElement("div");
    dialog.id = "nonstop-password-dialog";

    var p = document.createElement("p");
    p.textContent = message;
    dialog.appendChild(p);

    var input = document.createElement("input");
    input.type = "password";
    input.id = "nonstop-password-input";
    input.autofocus = true;
    dialog.appendChild(input);

    var submit = document.createElement("button");
    submit.id = "nonstop-password-submit";
    submit.textContent = "Open";
    dialog.appendChild(submit);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    function onSubmit() {
      var pw = input.value;
      overlay.remove();
      callback(pw);
    }

    submit.addEventListener("click", onSubmit);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") onSubmit();
    });
  }

  // --- Page Initialization ---

  function initPages() {
    containerWidth = container.clientWidth;
    containerHeight = container.clientHeight;

    // Get first page to determine initial scale
    pdfDoc.getPage(1).then(function (page) {
      var viewport = page.getViewport({ scale: 1 });
      currentScale = computeScale(viewport);

      // Create placeholders for all pages
      for (var i = 1; i <= pdfDoc.numPages; i++) {
        createPagePlaceholder(i, viewport);
      }

      // Set up lazy rendering with IntersectionObserver
      observer = new IntersectionObserver(onPageVisible, {
        root: container,
        rootMargin: "200px 0px",
        threshold: 0,
      });

      pages.forEach(function (p) {
        observer.observe(p.div);
      });

      // Set up actual dimensions for each page (they may differ)
      for (var j = 1; j <= pdfDoc.numPages; j++) {
        updatePageDimensions(j);
      }
    });
  }

  function createPagePlaceholder(pageNum, defaultViewport) {
    var vp = defaultViewport;
    var width = Math.floor(vp.width * currentScale);
    var height = Math.floor(vp.height * currentScale);

    var div = document.createElement("div");
    div.className = "nonstop-page";
    div.dataset.page = pageNum;
    div.style.width = width + "px";
    div.style.height = height + "px";

    var canvas = document.createElement("canvas");
    div.appendChild(canvas);

    var textLayer = document.createElement("div");
    textLayer.className = "nonstop-text-layer";
    div.appendChild(textLayer);

    viewer.appendChild(div);

    pages.push({
      num: pageNum,
      div: div,
      canvas: canvas,
      textLayer: textLayer,
      viewport: null,
      rendered: false,
      rendering: false,
    });
  }

  function updatePageDimensions(pageNum) {
    pdfDoc.getPage(pageNum).then(function (page) {
      var vp = page.getViewport({ scale: 1 });
      var info = pages[pageNum - 1];
      info.baseViewport = vp;
      var width = Math.floor(vp.width * currentScale);
      var height = Math.floor(vp.height * currentScale);
      info.div.style.width = width + "px";
      info.div.style.height = height + "px";
    });
  }

  function computeScale(viewport) {
    var padding = 24;
    var availWidth = (containerWidth || container.clientWidth) - padding;
    var availHeight = (containerHeight || container.clientHeight) - padding;

    if (scaleMode === "page-width") {
      return availWidth / viewport.width;
    } else if (scaleMode === "page-fit") {
      return Math.min(availWidth / viewport.width, availHeight / viewport.height);
    } else if (scaleMode === "auto") {
      var fitWidth = availWidth / viewport.width;
      return Math.min(fitWidth, 1.5);
    } else {
      return parseFloat(scaleMode) || 1;
    }
  }

  // --- Lazy Page Rendering ---

  function onPageVisible(entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var pageNum = parseInt(entry.target.dataset.page, 10);
        renderPage(pageNum);
      }
    });
  }

  function renderPage(pageNum) {
    var info = pages[pageNum - 1];
    if (!info || info.rendered || info.rendering) return;
    info.rendering = true;

    pdfDoc.getPage(pageNum).then(function (page) {
      var viewport = page.getViewport({ scale: currentScale });
      info.viewport = viewport;

      var canvas = info.canvas;
      var ctx = canvas.getContext("2d");
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = Math.floor(viewport.width) + "px";
      canvas.style.height = Math.floor(viewport.height) + "px";
      ctx.scale(dpr, dpr);

      info.div.style.width = Math.floor(viewport.width) + "px";
      info.div.style.height = Math.floor(viewport.height) + "px";

      var renderTask = page.render({
        canvasContext: ctx,
        viewport: viewport,
      });

      renderTask.promise.then(function () {
        info.rendered = true;
        info.rendering = false;
        renderTextLayer(page, viewport, info.textLayer);
      }).catch(function () {
        info.rendering = false;
      });
    });
  }

  // Manual text layer rendering — pdfjsLib.renderTextLayer is not exported
  // in pdfjs-dist v3.11.174's core build, so we implement it ourselves.
  // Two-pass approach: create+position all spans, then correct widths via scaleX.
  function renderTextLayer(page, viewport, textLayerDiv) {
    page.getTextContent().then(function (textContent) {
      textLayerDiv.textContent = "";
      textLayerDiv.style.width = Math.floor(viewport.width) + "px";
      textLayerDiv.style.height = Math.floor(viewport.height) + "px";

      var items = textContent.items;
      var styles = textContent.styles;
      var vt = viewport.transform; // [a, b, c, d, tx, ty]
      var fragment = document.createDocumentFragment();
      var spanInfos = [];

      for (var i = 0; i < items.length; i++) {
        var item = items[i];

        if (item.hasEOL) {
          fragment.appendChild(document.createElement("br"));
        }
        if (!item.str) continue;

        // Compose viewport transform with item transform
        var it = item.transform;
        var a  = vt[0]*it[0] + vt[2]*it[1];
        var b  = vt[1]*it[0] + vt[3]*it[1];
        var c  = vt[0]*it[2] + vt[2]*it[3];
        var d  = vt[1]*it[2] + vt[3]*it[3];
        var tx = vt[0]*it[4] + vt[2]*it[5] + vt[4];
        var ty = vt[1]*it[4] + vt[3]*it[5] + vt[5];

        var fontSize = Math.hypot(c, d);
        if (fontSize < 1) continue;
        var angle = Math.atan2(b, a);

        var fontFamily = "sans-serif";
        if (item.fontName && styles[item.fontName]) {
          fontFamily = styles[item.fontName].fontFamily || fontFamily;
        }

        var span = document.createElement("span");
        span.textContent = item.str;
        span.style.fontSize = fontSize.toFixed(1) + "px";
        span.style.fontFamily = fontFamily;
        span.style.left = tx.toFixed(1) + "px";
        span.style.top = (ty - fontSize).toFixed(1) + "px";

        if (Math.abs(angle) > 0.001) {
          span.style.transform = "rotate(" + angle.toFixed(4) + "rad)";
        }

        if (item.dir === "rtl") {
          span.dir = "rtl";
        }

        fragment.appendChild(span);
        spanInfos.push({
          span: span,
          targetWidth: item.width * viewport.scale,
          angle: angle,
        });
      }

      // First pass: append all spans at once
      textLayerDiv.appendChild(fragment);

      // Second pass: measure rendered widths and correct with scaleX
      for (var j = 0; j < spanInfos.length; j++) {
        var info = spanInfos[j];
        if (info.targetWidth <= 0) continue;
        var actual = info.span.offsetWidth;
        if (actual <= 0) continue;
        var scaleX = info.targetWidth / actual;
        if (Math.abs(scaleX - 1) > 0.01) {
          var existing = info.span.style.transform;
          info.span.style.transform = (existing ? existing + " " : "") +
            "scaleX(" + scaleX.toFixed(3) + ")";
        }
      }
    });
  }

  // --- Zoom ---

  function setZoom(newScaleMode) {
    scaleMode = newScaleMode;
    if (!pdfDoc) return;

    var info = pages[0];
    if (!info || !info.baseViewport) return;

    var oldScale = currentScale;
    currentScale = computeScale(info.baseViewport);

    if (Math.abs(oldScale - currentScale) < 0.001) return;

    // Remember scroll position as a ratio
    var scrollRatio = container.scrollTop / (container.scrollHeight - container.clientHeight || 1);

    // Re-render all visible pages and update dimensions
    pages.forEach(function (p) {
      p.rendered = false;
      p.rendering = false;
      p.canvas.width = 0;
      p.canvas.height = 0;
      p.textLayer.textContent = "";

      if (p.baseViewport) {
        var w = Math.floor(p.baseViewport.width * currentScale);
        var h = Math.floor(p.baseViewport.height * currentScale);
        p.div.style.width = w + "px";
        p.div.style.height = h + "px";
      }
    });

    // Update zoom select display
    updateZoomDisplay();

    // Restore scroll position
    requestAnimationFrame(function () {
      container.scrollTop = scrollRatio * (container.scrollHeight - container.clientHeight);

      // Re-trigger observer for visible pages
      if (observer) {
        pages.forEach(function (p) {
          observer.unobserve(p.div);
          observer.observe(p.div);
        });
      }
    });
  }

  function updateZoomDisplay() {
    var opts = zoomSelect.options;
    var pct = Math.round(currentScale * 100) + "%";

    // Check if current scale matches a preset
    var matched = false;
    for (var i = 0; i < opts.length; i++) {
      if (opts[i].value === scaleMode) {
        zoomSelect.selectedIndex = i;
        matched = true;
        break;
      }
    }
    if (!matched) {
      // Add custom option
      var custom = zoomSelect.querySelector("[data-custom]");
      if (!custom) {
        custom = document.createElement("option");
        custom.dataset.custom = "1";
        zoomSelect.insertBefore(custom, zoomSelect.firstChild);
      }
      custom.value = String(currentScale);
      custom.textContent = pct;
      zoomSelect.selectedIndex = 0;
    }
  }

  function zoomIn() {
    var steps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
    var next = steps.find(function (s) { return s > currentScale + 0.01; });
    if (next) setZoom(String(next));
  }

  function zoomOut() {
    var steps = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
    var prev = null;
    for (var i = steps.length - 1; i >= 0; i--) {
      if (steps[i] < currentScale - 0.01) { prev = steps[i]; break; }
    }
    if (prev) setZoom(String(prev));
  }

  // --- Page Navigation ---

  function updateCurrentPage() {
    var scrollTop = container.scrollTop;
    var best = 1;
    var bestDist = Infinity;

    for (var i = 0; i < pages.length; i++) {
      var div = pages[i].div;
      var divTop = div.offsetTop - container.offsetTop;
      var divMid = divTop + div.offsetHeight / 2;
      var viewMid = scrollTop + container.clientHeight / 2;
      var dist = Math.abs(divMid - viewMid);
      if (dist < bestDist) {
        bestDist = dist;
        best = i + 1;
      }
    }

    if (best !== currentPageNum) {
      currentPageNum = best;
      pageInputEl.value = best;
    }
  }

  function goToPage(num) {
    num = Math.max(1, Math.min(num, pdfDoc ? pdfDoc.numPages : 1));
    if (pages[num - 1]) {
      pages[num - 1].div.scrollIntoView({ block: "start" });
      currentPageNum = num;
      pageInputEl.value = num;
    }
  }

  // --- Outline (bookmarks) ---

  function loadOutline() {
    pdfDoc.getOutline().then(function (outline) {
      if (!outline || outline.length === 0) return;
      var outlineEl = document.getElementById("nonstop-outline");
      buildOutlineTree(outline, outlineEl, 0);
    });
  }

  function buildOutlineTree(items, parentEl, depth) {
    items.forEach(function (item) {
      var a = document.createElement("a");
      a.href = "#";
      a.textContent = item.title;
      a.style.paddingLeft = (12 + depth * 16) + "px";
      a.addEventListener("click", function (e) {
        e.preventDefault();
        if (item.dest) {
          pdfDoc.getDestination(typeof item.dest === "string" ? item.dest : null).then(function (dest) {
            dest = dest || item.dest;
            if (Array.isArray(dest)) {
              pdfDoc.getPageIndex(dest[0]).then(function (idx) {
                goToPage(idx + 1);
              });
            }
          });
        }
      });
      parentEl.appendChild(a);

      if (item.items && item.items.length > 0) {
        buildOutlineTree(item.items, parentEl, depth + 1);
      }
    });
  }

  // --- Event Handlers ---

  // Toolbar buttons
  document.getElementById("nonstop-prev").addEventListener("click", function () {
    goToPage(currentPageNum - 1);
  });

  document.getElementById("nonstop-next").addEventListener("click", function () {
    goToPage(currentPageNum + 1);
  });

  document.getElementById("nonstop-zoom-out").addEventListener("click", zoomOut);
  document.getElementById("nonstop-zoom-in").addEventListener("click", zoomIn);

  zoomSelect.addEventListener("change", function () {
    setZoom(zoomSelect.value);
  });

  pageInputEl.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      var num = parseInt(pageInputEl.value, 10);
      if (num >= 1) goToPage(num);
      pageInputEl.blur();
    } else if (e.key === "Escape") {
      pageInputEl.value = currentPageNum;
      pageInputEl.blur();
    }
  });

  // Sidebar toggle
  var sidebar = document.getElementById("nonstop-sidebar");
  document.getElementById("nonstop-sidebar-toggle").addEventListener("click", function () {
    sidebar.classList.toggle("nonstop-hidden");
    container.classList.toggle("nonstop-sidebar-open");
    // Re-compute scale if using fit modes
    if (scaleMode === "page-width" || scaleMode === "page-fit" || scaleMode === "auto") {
      containerWidth = container.clientWidth;
      setZoom(scaleMode);
    }
  });

  // Scroll tracking
  var scrollTimer = null;
  container.addEventListener("scroll", function () {
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(updateCurrentPage, 50);
  });

  // Ctrl+mouse wheel zoom
  container.addEventListener("wheel", function (e) {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    }
  }, { passive: false });

  // Window resize
  var resizeTimer = null;
  window.addEventListener("resize", function () {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      containerWidth = container.clientWidth;
      containerHeight = container.clientHeight;
      if (scaleMode === "page-width" || scaleMode === "page-fit" || scaleMode === "auto") {
        setZoom(scaleMode);
      }
    }, 150);
  });

  // Focus the container so keyboard shortcuts work immediately
  requestAnimationFrame(function () {
    container.focus();
  });

  // --- Start ---

  loadPdf();
})();
