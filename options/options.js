"use strict";

document.addEventListener("DOMContentLoaded", async () => {
  const settings = await browser.storage.sync.get(null).catch(() => ({}));

  // New tab settings
  const newTabUrlEl = document.getElementById("newtab-url");
  if (settings.newTabUrl != null) {
    newTabUrlEl.value = settings.newTabUrl;
  }

  let saveTimer = null;
  newTabUrlEl.addEventListener("input", () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await browser.storage.sync.set({ newTabUrl: newTabUrlEl.value.trim() }).catch(() => {});
    }, 400);
  });

  newTabUrlEl.addEventListener("keydown", (e) => {
    if (e.key === "Escape") newTabUrlEl.blur();
  });

  // PDF settings
  const pdfCheckbox = document.querySelector("[name=pdfViewerEnabled]");
  if (settings.pdfViewerEnabled != null) {
    pdfCheckbox.checked = settings.pdfViewerEnabled;
  }

  pdfCheckbox.addEventListener("change", async () => {
    await browser.storage.sync.set({ pdfViewerEnabled: pdfCheckbox.checked }).catch(() => {});
  });
});
