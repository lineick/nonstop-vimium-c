"use strict";

// This page is used for file:// PDFs where filterResponseData doesn't apply.
// The PDF URL is passed via the ?file= query parameter.
var params = new URLSearchParams(window.location.search);
var file = params.get("file");
// Only allow file:// and http(s):// URLs to prevent javascript: injection
if (file && /^(file|https?):\/\//i.test(file)) {
  window.__nonstopPdfUrl = file;
  window.__nonstopExtUrl = location.href.replace(/pdf\/viewer-page\.html.*/, "");
  var fn = decodeURIComponent(file.split("/").pop().split("?")[0].split("#")[0]) || "PDF";
  if (!/\.pdf$/i.test(fn)) fn += ".pdf";
  var dl = document.getElementById("nonstop-download");
  dl.href = file;
  dl.download = fn;
  document.getElementById("nonstop-open").href = file;
  document.title = fn;
}

// Load extension settings for the viewer (async, will be ready before user interaction)
window.__nonstopSettings = { keyboardZoomStep: 0.5 };
if (typeof browser !== "undefined" && browser.storage) {
  browser.storage.sync.get(["keyboardZoomStep"]).then(function (data) {
    if (data.keyboardZoomStep != null) {
      window.__nonstopSettings.keyboardZoomStep = data.keyboardZoomStep;
    }
  }).catch(function () {});
}
