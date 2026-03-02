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

  // Keyboard zoom step
  const zoomStepEl = document.getElementById("keyboard-zoom-step");
  if (settings.keyboardZoomStep != null) {
    zoomStepEl.value = Math.round(settings.keyboardZoomStep * 100);
  }

  let zoomStepTimer = null;
  zoomStepEl.addEventListener("input", () => {
    clearTimeout(zoomStepTimer);
    zoomStepTimer = setTimeout(async () => {
      const pct = parseInt(zoomStepEl.value, 10);
      if (pct >= 5 && pct <= 200) {
        await browser.storage.sync.set({ keyboardZoomStep: pct / 100 }).catch(() => {});
      }
    }, 400);
  });
});
