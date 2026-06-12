"use strict";

// structural regression tests for progressive layer rendering: the viewer
// must be interactive before the whole document is built, render scrolled-to
// pages out of order, and never keep stale-scale spans after a zoom. these
// deliberately avoid wall-clock assertions; they assert observable rendering
// states on a 120-page fixture instead.

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { startFixtureServer, startBrowser, discoverExtensionUuid, fixtureUrl } =
  require("./helpers");

let server, driver, gecko, uuid;

const SNAPSHOT = `
  const groups = [...document.querySelectorAll(".nonstop-text-group")];
  const canvas = document.querySelector(".nonstop-page canvas");
  return {
    total: groups.length,
    populated: groups.filter(g => g.children.length > 0).length,
    firstReady: groups.length > 0 && groups[0].querySelectorAll("span").length > 10,
    canvasReady: !!canvas && canvas.width > 0,
  };
`;

// navigates without helpers.openViewer, whose readiness predicate waits for
// the background fill to complete (the opposite of what these tests observe)
async function openLazy(name) {
  await driver.get(
    "moz-extension://" + uuid + "/pdf/viewer-page.html?file=" +
    encodeURIComponent(fixtureUrl(name))
  );
}

async function pollSnapshot(pred, timeout, msg) {
  let snap = null;
  await driver.wait(async () => {
    snap = await driver.executeScript(SNAPSHOT).catch(() => null);
    return snap && pred(snap);
  }, timeout, msg);
  return snap;
}

before(async () => {
  server = startFixtureServer();
  ({ driver, gecko } = await startBrowser());
  uuid = await discoverExtensionUuid(driver);
});

after(async () => {
  if (driver) await driver.quit();
  if (gecko) gecko.kill();
  if (server) server.close();
});

test("open is lazy: first page is ready long before the document fill completes", async () => {
  await openLazy("lipsum-120.pdf");
  const snap = await pollSnapshot(
    s => s.firstReady && s.canvasReady, 60000, "first page never became ready");
  assert.ok(snap.total >= 100, "fixture should have >= 100 pages, got " + snap.total);
  assert.ok(snap.populated < snap.total,
    "expected a partially filled document when page 1 is ready, but all " +
    snap.total + " text groups were already populated (eager rendering regression)");

  // the background fill must still finish, or whole-document Ctrl+F breaks
  await pollSnapshot(
    s => s.populated === s.total, 120000, "background fill never completed");
});

test("scrolling ahead of the fill renders the visible page out of order", async () => {
  await openLazy("lipsum-120.pdf");
  await pollSnapshot(s => s.firstReady, 60000, "first page never became ready");
  await driver.executeScript(`
    const container = document.getElementById("nonstop-container");
    container.scrollTop = container.scrollHeight;
  `);

  let snap = null;
  await driver.wait(async () => {
    snap = await driver.executeScript(`
      const groups = [...document.querySelectorAll(".nonstop-text-group")];
      return {
        last: groups[groups.length - 1].children.length > 0,
        mid: groups[Math.floor(groups.length / 2)].children.length > 0,
      };
    `).catch(() => null);
    return snap && snap.last;
  }, 60000, "scrolled-to last page never rendered");
  assert.ok(!snap.mid,
    "middle of the document was already rendered when the scrolled-to last page " +
    "appeared; the observer no longer outruns the document-order fill");
});

test("zoom clears all layers synchronously and refills lazily at the new scale", async () => {
  await openLazy("lipsum-120.pdf");
  await pollSnapshot(s => s.populated === s.total && s.total >= 100,
    120000, "initial fill never completed");

  const beforeTop = await driver.executeScript(`
    const groups = document.querySelectorAll(".nonstop-text-group");
    document.getElementById("nonstop-container").scrollTop = 0;
    return parseFloat(groups[groups.length - 1].querySelector("span").style.top);
  `);

  // dispatch the zoom and inspect the layers in the SAME task: setZoom is
  // synchronous, so stale-scale spans (which would overlay other pages in the
  // shared layer) must already be gone here
  const atZoom = await driver.executeScript(`
    const sel = document.getElementById("nonstop-zoom-select");
    sel.value = "2";
    sel.dispatchEvent(new Event("change"));
    const groups = [...document.querySelectorAll(".nonstop-text-group")];
    return {
      total: groups.length,
      populated: groups.filter(g => g.children.length > 0).length,
      lastCleared: groups[groups.length - 1].children.length === 0,
    };
  `);
  assert.ok(atZoom.lastCleared, "stale-scale spans survived the zoom in the shared layer");
  assert.ok(atZoom.populated < atZoom.total,
    "all groups were re-rendered synchronously on zoom (eager zoom regression)");

  const refilled = await pollSnapshot(
    s => s.populated === s.total, 120000, "refill after zoom never completed");
  assert.equal(refilled.total, atZoom.total);

  const afterTop = await driver.executeScript(`
    const groups = document.querySelectorAll(".nonstop-text-group");
    return parseFloat(groups[groups.length - 1].querySelector("span").style.top);
  `);
  assert.ok(afterTop / beforeTop > 1.5,
    "far pages were not re-laid out at the new scale: span top went from " +
    beforeTop + " to " + afterTop);
});
