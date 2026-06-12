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
  var pages = [];         // see createPagePlaceholder for the entry shape
  var textLayerEl = null; // single document-wide text layer (see viewer.css)
  var layerGeneration = 0;  // bumped on zoom; invalidates in-flight layer renders
  var layersReady = false;  // all page divs sized, layer offsets are final
  var lastScrollTime = 0;   // background fill yields to active scrolling
  var currentScale = 1;
  var zoomStorageKey = "nonstop-zoom:" + pdfUrl;
  var scaleMode = sessionStorage.getItem(zoomStorageKey) || "page-fit";
  var containerWidth = 0;
  var containerHeight = 0;
  var observer = null;
  var currentPageNum = 1;

  // Expose viewer API for external scripts (e.g. Vimium C content scripts)
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
      updateZoomDisplay();

      createTextLayer();

      // Create placeholders for all pages
      for (var i = 1; i <= pdfDoc.numPages; i++) {
        createPagePlaceholder(i, viewport);
      }
      var endOfContent = document.createElement("div");
      endOfContent.className = "endOfContent";
      textLayerEl.appendChild(endOfContent);
      viewer.appendChild(textLayerEl);

      // Set up lazy rendering with IntersectionObserver
      observer = new IntersectionObserver(onPageVisible, {
        root: container,
        rootMargin: "200px 0px",
        threshold: 0,
      });

      pages.forEach(function (p) {
        observer.observe(p.div);
      });

      // Size all page divs first: text spans in the shared layer are positioned
      // by page offset, so every page above them must have its final height
      var sized = pages.map(function (info) {
        return pdfDoc.getPage(info.num).then(function (p) {
          info.baseViewport = p.getViewport({ scale: 1 });
          info.pageProxy = p;
          info.div.style.width = Math.floor(info.baseViewport.width * currentScale) + "px";
          info.div.style.height = Math.floor(info.baseViewport.height * currentScale) + "px";
        });
      });

      Promise.all(sized).then(function () {
        sizeTextLayer();
        layersReady = true;
        observePages();   // visible pages render their layers first
        fillPageLayers(); // the rest fills in the background (Ctrl+F everywhere)
      });
    });
  }

  function createTextLayer() {
    textLayerEl = document.createElement("div");
    textLayerEl.className = "nonstop-text-layer textLayer";

    // Bind endOfContent mouse events once (like pdf.js, aids mouse drag selection)
    textLayerEl.addEventListener("mousedown", function () {
      var end = textLayerEl.querySelector(".endOfContent");
      if (end) end.classList.add("active");
    });
    textLayerEl.addEventListener("mouseup", function () {
      var end = textLayerEl.querySelector(".endOfContent");
      if (end) end.classList.remove("active");
    });
  }

  // The shared text layer is as wide as the widest page; both are centered,
  // so each page's horizontal offset inside the layer is (layerW - pageW) / 2
  function sizeTextLayer() {
    var maxWidth = 0;
    pages.forEach(function (p) {
      maxWidth = Math.max(maxWidth, p.div.offsetWidth);
    });
    textLayerEl.style.width = maxWidth + "px";
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

    var textGroup = document.createElement("div");
    textGroup.className = "nonstop-text-group";
    textGroup.dataset.page = pageNum;
    textLayerEl.appendChild(textGroup);

    var annotationLayer = document.createElement("div");
    annotationLayer.className = "nonstop-annotation-layer";
    div.appendChild(annotationLayer);

    viewer.appendChild(div);

    pages.push({
      num: pageNum,
      div: div,
      canvas: canvas,
      textGroup: textGroup,
      annotationLayer: annotationLayer,
      viewport: null,
      rendered: false,
      rendering: false,
      layersRendered: false,
      pageProxy: null,
      textContent: null,
      annotations: null,
    });
  }

  // Render one page's text group and link overlays. Idempotent per zoom
  // generation: concurrent callers (observer and background fill) skip pages
  // already done or in flight; a render that resolves after a zoom is dropped.
  function renderPageLayers(info) {
    if (info.layersRendered) return Promise.resolve();
    info.layersRendered = true;
    var gen = layerGeneration;
    var page = info.pageProxy;

    return Promise.all([
      info.textContent || page.getTextContent(),
      info.annotations || page.getAnnotations(),
    ]).then(function (results) {
      info.textContent = results[0];
      info.annotations = results[1];
      if (gen !== layerGeneration) return;
      var viewport = page.getViewport({ scale: currentScale });
      applySpanWidths(renderTextLayerFromContent(info.textContent, viewport, info));
      renderAnnotationLayer(info, viewport);
    });
  }

  // Fill the remaining pages' layers in document order, one page per task so
  // scroll, paint and input stay responsive in between, and paused entirely
  // while the user is scrolling (visible pages still render via the observer).
  // Pages the observer already rendered are skipped; a zoom aborts the chain
  // via layerGeneration.
  function fillPageLayers() {
    var gen = layerGeneration;
    var i = 0;
    function next() {
      if (gen !== layerGeneration) return;
      if (performance.now() - lastScrollTime < 150) {
        setTimeout(next, 200);
        return;
      }
      while (i < pages.length && pages[i].layersRendered) i++;
      if (i >= pages.length) return;
      renderPageLayers(pages[i]).then(function () {
        setTimeout(next, 0);
      });
    }
    next();
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

  // Re-observing makes the observer re-report already-intersecting pages, so
  // whatever is on screen renders immediately (used at load and after zoom)
  function observePages() {
    pages.forEach(function (p) {
      observer.unobserve(p.div);
      observer.observe(p.div);
    });
  }

  function onPageVisible(entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        var pageNum = parseInt(entry.target.dataset.page, 10);
        renderPage(pageNum);
        if (layersReady) renderPageLayers(pages[pageNum - 1]);
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

      page.render({
        canvasContext: ctx,
        viewport: viewport,
      }).promise.then(function () {
        info.rendered = true;
        info.rendering = false;
      }).catch(function () {
        info.rendering = false;
      });
    });
  }

  function makeBr() {
    var br = document.createElement("br");
    br.setAttribute("role", "presentation");
    return br;
  }

  // Manual text layer rendering into the page's group of the shared layer.
  // Two-pass approach: create+position all spans, then correct widths via
  // scaleX (applySpanWidths, kept separate so zoom can batch the measurement).
  // Brs are kept in normal flow (see viewer.css) and one is emitted per visual
  // line so that Gecko's Selection.modify("line") moves line by line.
  function renderTextLayerFromContent(textContent, viewport, info) {
    var group = info.textGroup;
    group.textContent = "";

    // page offset inside the shared text layer (both are centered)
    var offX = (textLayerEl.offsetWidth - info.div.offsetWidth) / 2;
    var offY = info.div.offsetTop;

    var items = textContent.items;
    var styles = textContent.styles;
    var vt = viewport.transform; // [a, b, c, d, tx, ty]
    var fragment = document.createDocumentFragment();
    var spanInfos = [];
    var lastTy = null;
    var lastFontSize = 0;

    for (var i = 0; i < items.length; i++) {
      var item = items[i];

      if (!item.str) {
        if (item.hasEOL) {
          fragment.appendChild(makeBr());
          lastTy = null;
        }
        continue;
      }

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

      // synthesize a line break when the baseline jumps and the PDF did not
      // mark one via hasEOL (threshold tolerates sub/superscripts)
      if (lastTy !== null && Math.abs(ty - lastTy) > 0.5 * Math.max(fontSize, lastFontSize)) {
        fragment.appendChild(makeBr());
      }
      lastTy = ty;
      lastFontSize = fontSize;

      var fontFamily = "sans-serif";
      if (item.fontName && styles[item.fontName]) {
        fontFamily = styles[item.fontName].fontFamily || fontFamily;
      }

      var span = document.createElement("span");
      span.setAttribute("role", "presentation");
      span.textContent = item.str;
      span.style.fontSize = fontSize.toFixed(1) + "px";
      span.style.fontFamily = fontFamily;
      span.style.left = (offX + tx).toFixed(1) + "px";
      span.style.top = (offY + ty - fontSize).toFixed(1) + "px";

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

      if (item.hasEOL) {
        fragment.appendChild(makeBr());
        lastTy = null;
      }
    }

    group.appendChild(fragment);
    return spanInfos;
  }

  // Second pass: measure rendered widths and correct with scaleX. All reads
  // happen before all writes: a transform change reframes the span in Gecko,
  // so interleaving would re-trigger layout work per span (quadratic in
  // document size for the shared layer).
  function applySpanWidths(spanInfos) {
    for (var j = 0; j < spanInfos.length; j++) {
      var sInfo = spanInfos[j];
      sInfo.actualWidth = sInfo.targetWidth > 0 ? sInfo.span.offsetWidth : 0;
    }
    for (var k = 0; k < spanInfos.length; k++) {
      var s = spanInfos[k];
      if (s.actualWidth <= 0) continue;
      var scaleX = s.targetWidth / s.actualWidth;
      if (Math.abs(scaleX - 1) > 0.01) {
        var existing = s.span.style.transform;
        s.span.style.transform = (existing ? existing + " " : "") +
          "scaleX(" + scaleX.toFixed(3) + ")";
      }
    }
  }

  // Link annotations rendered as transparent <a> overlays
  function renderAnnotationLayer(info, viewport) {
    var layer = info.annotationLayer;
    layer.textContent = "";
    layer.style.width = Math.floor(viewport.width) + "px";
    layer.style.height = Math.floor(viewport.height) + "px";

    info.annotations.forEach(function (annot) {
      if (annot.subtype !== "Link" || (!annot.url && !annot.dest)) return;

      var rect = viewport.convertToViewportRectangle(annot.rect);
      var width = Math.abs(rect[0] - rect[2]);
      var height = Math.abs(rect[1] - rect[3]);
      if (width <= 0 || height <= 0) return;

      var a = document.createElement("a");
      a.style.left = Math.min(rect[0], rect[2]).toFixed(1) + "px";
      a.style.top = Math.min(rect[1], rect[3]).toFixed(1) + "px";
      a.style.width = width.toFixed(1) + "px";
      a.style.height = height.toFixed(1) + "px";

      if (annot.url) {
        a.href = annot.url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.title = annot.url;
      } else {
        a.href = "#";
        a.addEventListener("click", function (e) {
          e.preventDefault();
          goToDest(annot.dest);
        });
      }
      layer.appendChild(a);
    });
  }

  // --- Zoom ---

  function setZoom(newScaleMode) {
    scaleMode = newScaleMode;
    try { sessionStorage.setItem(zoomStorageKey, scaleMode); } catch (e) {}
    if (!pdfDoc) return;

    var info = pages[0];
    if (!info || !info.baseViewport) return;

    var oldScale = currentScale;
    currentScale = computeScale(info.baseViewport);

    if (Math.abs(oldScale - currentScale) < 0.001) return;

    // Remember scroll position as a ratio
    var scrollRatio = container.scrollTop / (container.scrollHeight - container.clientHeight || 1);

    // Drop in-flight layer renders; their output would be at the old scale
    layerGeneration++;

    // Reset canvas and layer state, update dimensions. Groups must be cleared
    // right away: they share one layer, so stale spans would overlap other
    // pages. Re-rendering happens lazily (visible pages first, via observer).
    pages.forEach(function (p) {
      p.rendered = false;
      p.rendering = false;
      p.canvas.width = 0;
      p.canvas.height = 0;
      p.layersRendered = false;
      p.textGroup.textContent = "";
      p.annotationLayer.textContent = "";

      if (p.baseViewport) {
        var w = Math.floor(p.baseViewport.width * currentScale);
        var h = Math.floor(p.baseViewport.height * currentScale);
        p.div.style.width = w + "px";
        p.div.style.height = h + "px";
      }
    });
    sizeTextLayer();

    // Update zoom select display
    updateZoomDisplay();

    // Restore scroll position
    requestAnimationFrame(function () {
      container.scrollTop = scrollRatio * (container.scrollHeight - container.clientHeight);

      if (observer) observePages();
      if (layersReady) fillPageLayers();
    });
  }

  function updateZoomDisplay() {
    var opts = zoomSelect.options;

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
      custom.textContent = Math.round(currentScale * 100) + "%";
      zoomSelect.selectedIndex = 0;
    }
  }

  function getZoomStep(scale) {
    if (scale < 1.1) return 0.1;
    if (scale < 2) return 0.2;
    if (scale < 4) return 0.3;
    return 0.5;
  }

  function zoomIn() {
    var step = getZoomStep(currentScale);
    var target = currentScale + step;
    target = Math.round(target * 10) / 10; // Snap to nearest 10%
    if (target > currentScale) setZoom(String(Math.min(target, 5)));
  }

  function zoomOut() {
    var step = getZoomStep(currentScale);
    var target = currentScale - step;
    target = Math.round(target * 10) / 10; // Snap to nearest 10%
    if (target < currentScale) setZoom(String(Math.max(target, 0.1)));
  }

  // --- Page Navigation ---

  function updateCurrentPage() {
    var scrollTop = container.scrollTop;
    var best = 1;
    var bestDist = Infinity;

    for (var i = 0; i < pages.length; i++) {
      var div = pages[i].div;
      // offsetTop is relative to #nonstop-viewer, which sits at the top of
      // the scroll content, so it is directly comparable to scrollTop
      var divMid = div.offsetTop + div.offsetHeight / 2;
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

  // Navigate to a PDF destination (named string or explicit array)
  function goToDest(dest) {
    var resolved = typeof dest === "string" ? pdfDoc.getDestination(dest) : Promise.resolve(dest);
    resolved.then(function (d) {
      if (Array.isArray(d) && d[0] != null) {
        pdfDoc.getPageIndex(d[0]).then(function (idx) {
          scrollToDest(idx + 1, d);
        });
      }
    });
  }

  // Scroll so the destination's y coordinate (PDF user space) is vertically
  // centered in the view. Destination arrays look like [page, {name}, ...]:
  // XYZ carries y at [3], FitH/FitBH at [2], FitR's top edge at [5]; y may be
  // null ("keep current position"). Other types fall back to the page top.
  function scrollToDest(pageNum, d) {
    var info = pages[pageNum - 1];
    var type = d[1] && d[1].name;
    var x = 0;
    var y = null;
    if (type === "XYZ") { x = d[2] || 0; y = d[3]; }
    else if (type === "FitH" || type === "FitBH") y = d[2];
    else if (type === "FitR") { x = d[2] || 0; y = d[5]; }

    if (!info || !info.pageProxy || typeof y !== "number") {
      goToPage(pageNum);
      return;
    }
    var viewport = info.pageProxy.getViewport({ scale: currentScale });
    // x matters for rotated pages, where the viewport y depends on it
    var pt = viewport.convertToViewportPoint(x, y);
    container.scrollTop = Math.max(0, info.div.offsetTop + pt[1] - container.clientHeight / 2);
    currentPageNum = pageNum;
    pageInputEl.value = pageNum;
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
        if (item.dest) goToDest(item.dest);
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
    lastScrollTime = performance.now();
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(updateCurrentPage, 50);
  });

  // Ctrl+mouse wheel zoom (10% steps)
  container.addEventListener("wheel", function (e) {
    if (e.ctrlKey) {
      e.preventDefault();
      if (e.deltaY < 0) zoomIn();
      else if (e.deltaY > 0) zoomOut();
    }
  }, { passive: false });

  // Ctrl+Plus / Ctrl+Minus / Ctrl+0 keyboard zoom (configurable step)
  function getKeyboardZoomStep() {
    var s = window.__nonstopSettings;
    return (s && s.keyboardZoomStep != null) ? s.keyboardZoomStep : 0.5;
  }

  function keyboardZoomIn() {
    var step = getKeyboardZoomStep();
    var target = currentScale + step;
    target = Math.round(target * 10) / 10;
    if (target > currentScale) setZoom(String(Math.min(target, 5)));
  }

  function keyboardZoomOut() {
    var step = getKeyboardZoomStep();
    var target = currentScale - step;
    target = Math.round(target * 10) / 10;
    if (target < currentScale) setZoom(String(Math.max(target, 0.1)));
  }

  document.addEventListener("keydown", function (e) {
    if (!e.ctrlKey && !e.metaKey) return;
    var tag = (e.target && e.target.tagName) || "";
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      keyboardZoomIn();
    } else if (e.key === "-") {
      e.preventDefault();
      keyboardZoomOut();
    } else if (e.key === "0") {
      e.preventDefault();
      setZoom("1");
    }
  });

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

  // Prevent the scrollable container from consuming single-key presses
  // (j, k, space, up/down arrows, etc.) via the browser's default scroll behavior.
  // Vimium-C captures keys at a higher level and handles them itself;
  // the container's native scroll-on-keypress interferes with that.
  // Only allow through modifier combos (Ctrl+C, etc.) and input-field keys.
  // Left/right arrows navigate between pages.
  container.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    // Let Tab and F-keys through
    if (e.key === "Tab" || e.key.length > 1 && e.key.startsWith("F")) return;
    // Left/right arrows for page navigation
    if (e.key === "ArrowLeft") {
      goToPage(currentPageNum - 1);
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowRight") {
      goToPage(currentPageNum + 1);
      e.preventDefault();
      return;
    }
    e.preventDefault();
  });

  // Focus the container so keyboard shortcuts work immediately
  requestAnimationFrame(function () {
    container.focus();
  });

  // --- Start ---

  loadPdf();
})();
