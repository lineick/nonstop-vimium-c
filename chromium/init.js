// @ts-check
/// <reference path="browser.d.ts" />

/** @param {string} message */
function showMessage(message) {
  const dialog = document.createElement("dialog");
  const text = document.createElement("p");
  const close = document.createElement("button");
  text.textContent = message;
  close.textContent = "Dismiss";
  close.addEventListener("click", () => dialog.remove());
  dialog.append(text, close);
  document.body.append(dialog);
  dialog.showModal();
}

async function connectVimium() {
  /** @type {{ id: string, version: string }} */
  const expected = await (await fetch(chrome.runtime.getURL("vimium.json"))).json();
  const backend = await chrome.runtime.sendMessage(expected.id, { handler: "id" });
  if (!backend) {
    throw new Error(`Add ${chrome.runtime.id} to Vimium C's advanced extension allowlist, then reload the PDF.`);
  }
  if (typeof backend !== "object" || !("version" in backend) || backend.version !== expected.version) {
    throw new Error(`This Chromium preview requires Vimium C ${expected.version}. Vimium C updates require an updated preview.`);
  }
  const injector = document.createElement("script");
  injector.src = chrome.runtime.getURL("vendor/vimium-c/injector.js");
  injector.dataset.extensionId = expected.id;
  document.body.append(injector);
}

async function openPdf() {
  const info = await chrome.mimeHandler.getStreamInfo();
  const response = await fetch(info.streamUrl);
  if (!response.ok) throw new Error(`Could not read the PDF stream (${response.status}).`);
  const data = await response.arrayBuffer();
  window.__nonstopPdfUrl = info.originalUrl;
  window.__nonstopExtUrl = chrome.runtime.getURL("");
  window.__nonstopPdfData = new Uint8Array(data);
  window.__nonstopSettings = { keyboardZoomStep: 0.5 };
  const filename = new URL(info.originalUrl).pathname.split("/").pop() || "PDF";
  document.title = filename;

  // Save the received bytes, including PDFs delivered by POST or single-use URLs.
  const download = /** @type {HTMLAnchorElement} */ (document.getElementById("nonstop-download"));
  download.href = URL.createObjectURL(new Blob([data], { type: "application/pdf" }));
  download.download = filename;
  const native = /** @type {HTMLAnchorElement} */ (document.getElementById("nonstop-open"));
  native.href = "#";
  native.removeAttribute("target");
  native.title = "Open in the browser's PDF viewer";
  native.addEventListener("click", (event) => {
    event.preventDefault();
    chrome.mimeHandler.abortAndFallbackToNativeHandler().catch((error) => showMessage(String(error)));
  });

  const viewer = document.createElement("script");
  viewer.src = chrome.runtime.getURL("pdf/viewer.js");
  document.body.append(viewer);
  connectVimium().catch((error) => showMessage(`Vimium C could not connect. ${error}`));
}

openPdf().catch((error) => showMessage(`Could not open the PDF. ${error}`));
