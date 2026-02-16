"use strict";

let pdfViewerEnabled = true;
let newTabUrl = "";

// Load settings
browser.storage.sync.get(["pdfViewerEnabled", "newTabUrl"]).then((data) => {
  if (data.pdfViewerEnabled != null) pdfViewerEnabled = data.pdfViewerEnabled;
  if (data.newTabUrl != null) newTabUrl = data.newTabUrl;
}).catch(() => {});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  if (changes.pdfViewerEnabled) {
    pdfViewerEnabled = changes.pdfViewerEnabled.newValue !== false;
  }
  if (changes.newTabUrl) {
    newTabUrl = changes.newTabUrl.newValue || "";
  }
});

// Instead of chrome_url_overrides (which always shows extension name in address
// bar and steals focus), we listen for new tabs and redirect via tabs.update().
// This only activates when a URL is configured in settings.

browser.tabs.onCreated.addListener((tab) => {
  if (!newTabUrl) return;
  // Only redirect actual new tabs (not tabs opened with a URL)
  if (tab.url === "about:newtab" || tab.url === "about:blank" || !tab.url) {
    browser.tabs.update(tab.id, { url: newTabUrl });
  }
});

// --- PDF Detection Helpers ---

function getHeader(headers, name) {
  for (const header of headers) {
    if (header.name.toLowerCase() === name) {
      return header;
    }
  }
  return null;
}

function isPdfResponse(details) {
  const ct = getHeader(details.responseHeaders, "content-type");
  if (!ct) return false;
  const value = ct.value.toLowerCase().split(";", 1)[0].trim();
  if (value === "application/pdf") return true;
  if (value === "application/octet-stream") {
    if (/\.pdf($|\?|#)/i.test(details.url)) return true;
    const cd = getHeader(details.responseHeaders, "content-disposition");
    if (cd && /\.pdf(["']|$)/i.test(cd.value)) return true;
  }
  return false;
}

function isPdfDownload(details) {
  if (details.url.includes("pdfjs.action=download")) return true;
  if (details.url.includes("=download")) {
    const cd = getHeader(details.responseHeaders, "content-disposition");
    return cd && /^attachment/i.test(cd.value);
  }
  return false;
}

// --- Viewer HTML Builder ---

function buildViewerHtml(pdfUrl) {
  const extUrl = browser.runtime.getURL("");
  const filename = decodeURIComponent(pdfUrl.split("/").pop().split("?")[0].split("#")[0]) || "PDF";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(filename)}</title>
<link rel="stylesheet" href="${extUrl}pdf/viewer.css">
</head>
<body>
<div id="nonstop-toolbar">
  <div id="nonstop-toolbar-left">
    <button id="nonstop-sidebar-toggle" title="Toggle Sidebar">&#9776;</button>
    <button id="nonstop-prev" title="Previous Page">&lsaquo;</button>
    <span id="nonstop-page-info">
      <input id="nonstop-page-input" type="text" value="1" size="3">
      / <span id="nonstop-page-count">-</span>
    </span>
    <button id="nonstop-next" title="Next Page">&rsaquo;</button>
  </div>
  <div id="nonstop-toolbar-center">
    <button id="nonstop-zoom-out" title="Zoom Out (-)">&#x2212;</button>
    <select id="nonstop-zoom-select">
      <option value="auto">Automatic</option>
      <option value="page-width" selected>Page Width</option>
      <option value="page-fit">Page Fit</option>
      <option value="0.5">50%</option>
      <option value="0.75">75%</option>
      <option value="1">100%</option>
      <option value="1.25">125%</option>
      <option value="1.5">150%</option>
      <option value="2">200%</option>
      <option value="3">300%</option>
    </select>
    <button id="nonstop-zoom-in" title="Zoom In (+)">+</button>
  </div>
  <div id="nonstop-toolbar-right">
    <a id="nonstop-download" href="${escapeHtml(pdfUrl)}" download title="Download">&#11015;</a>
    <a id="nonstop-open" href="${escapeHtml(pdfUrl)}" target="_blank" title="Open Original">&#8599;</a>
  </div>
</div>
<div id="nonstop-sidebar" class="nonstop-hidden">
  <div id="nonstop-outline"></div>
</div>
<div id="nonstop-container" tabindex="0">
  <div id="nonstop-viewer"></div>
</div>
<div id="nonstop-loading">Loading PDF&#8230;</div>
<script>
  window.__nonstopPdfUrl = ${JSON.stringify(pdfUrl).replace(/</g, "\\u003c")};
  window.__nonstopExtUrl = ${JSON.stringify(extUrl).replace(/</g, "\\u003c")};
</script>
<script src="${extUrl}pdf/lib/pdf.min.js"></script>
<script src="${extUrl}pdf/viewer.js"></script>
<script src="${extUrl}pdf/vimium-bridge.js"></script>
</body>
</html>`;
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- PDF Response Interception ---

browser.webRequest.onHeadersReceived.addListener(
  function (details) {
    if (!pdfViewerEnabled) return;
    if (details.method !== "GET") return;
    if (details.statusCode >= 400) return;
    if (!isPdfResponse(details)) return;
    if (isPdfDownload(details)) return;

    // Modify response headers
    const headers = details.responseHeaders.filter(
      (h) => !["content-security-policy", "content-security-policy-report-only",
               "x-frame-options", "content-disposition"].includes(h.name.toLowerCase())
    );

    const ctHeader = getHeader(headers, "content-type");
    if (ctHeader) {
      ctHeader.value = "text/html; charset=utf-8";
    } else {
      headers.push({ name: "Content-Type", value: "text/html; charset=utf-8" });
    }

    // Remove content-length since we're changing the body
    const clIdx = headers.findIndex((h) => h.name.toLowerCase() === "content-length");
    if (clIdx >= 0) headers.splice(clIdx, 1);

    // Use filterResponseData to replace the PDF with our viewer HTML
    const filter = browser.webRequest.filterResponseData(details.requestId);
    let wroteHtml = false;

    function writeViewer() {
      if (wroteHtml) return;
      wroteHtml = true;
      const html = buildViewerHtml(details.url);
      filter.write(new TextEncoder().encode(html));
    }

    filter.ondata = () => {
      // Write viewer HTML on first chunk, discard all PDF data
      writeViewer();
    };

    filter.onstop = () => {
      writeViewer(); // In case no data chunks arrived
      filter.close();
    };

    filter.onerror = () => {
      try { filter.disconnect(); } catch (e) { /* ignore */ }
    };

    return { responseHeaders: headers };
  },
  { urls: ["<all_urls>"], types: ["main_frame", "sub_frame"] },
  ["blocking", "responseHeaders"]
);

// --- Handle file:// PDFs via onBeforeRequest ---

browser.webRequest.onBeforeRequest.addListener(
  function (details) {
    if (!pdfViewerEnabled) return;
    if (details.originUrl && details.originUrl.startsWith(browser.runtime.getURL(""))) return;

    const viewerUrl = browser.runtime.getURL("pdf/viewer-page.html") +
      "?file=" + encodeURIComponent(details.url);
    return { redirectUrl: viewerUrl };
  },
  {
    urls: ["file://*/*.pdf", "file://*/*.PDF"],
    types: ["main_frame"],
  },
  ["blocking"]
);
