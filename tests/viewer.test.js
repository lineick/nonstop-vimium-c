"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { startFixtureServer, startBrowser, discoverExtensionUuid, openViewer, fixtureUrl } =
  require("./helpers");

let server, driver, gecko, uuid;

// page-side helpers used by the selection tests
const INSTALL_PAGE_HELPERS = `
  window.__t = {
    // positions are content-relative (rect.top + scrollTop): gecko asynchronously
    // scrolls the selection focus into view between steps, so viewport-relative
    // coordinates would be off by the scroll distance
    caretOnPage(pageIdx, spanIdx, offset) {
      const group = document.querySelectorAll(".nonstop-text-group")[pageIdx];
      const spans = [...group.querySelectorAll("span")].filter(s => s.textContent.trim().length > 5);
      if (spanIdx < 0) spanIdx += spans.length;
      const span = spans[spanIdx];
      const sel = getSelection();
      sel.removeAllRanges();
      const r = document.createRange();
      r.setStart(span.firstChild, offset);
      r.collapse(true);
      sel.addRange(r);
      const container = document.getElementById("nonstop-container");
      return span.getBoundingClientRect().top + container.scrollTop;
    },
    // caret shortly before the end of a visual line: the lineIdx-th span on
    // the page that is directly followed by a br
    caretEndOfLine(pageIdx, lineIdx) {
      const group = document.querySelectorAll(".nonstop-text-group")[pageIdx];
      const spans = [...group.querySelectorAll("span")].filter(s =>
        s.nextSibling && s.nextSibling.nodeName === "BR" && s.textContent.trim().length > 5);
      const span = spans[lineIdx];
      const sel = getSelection();
      sel.removeAllRanges();
      const r = document.createRange();
      r.setStart(span.firstChild, span.firstChild.length - 2);
      r.collapse(true);
      sel.addRange(r);
      const container = document.getElementById("nonstop-container");
      return span.getBoundingClientRect().top + container.scrollTop;
    },
    // one word-extend step; returns the caret rect at the selection focus,
    // which is what Vimium C scrolls into view after each w press
    wordStep() {
      const sel = getSelection();
      sel.modify("extend", "forward", "word");
      const r = document.createRange();
      r.setStart(sel.focusNode, sel.focusOffset);
      r.collapse(true);
      const rect = r.getClientRects()[0] || r.getBoundingClientRect();
      const container = document.getElementById("nonstop-container");
      const n = sel.focusNode;
      return {
        node: n.nodeType === 3 ? "#text" : n.nodeName,
        top: rect.top + container.scrollTop,
        left: rect.left,
      };
    },
    modifyStep(alter, dir, granularity) {
      const sel = getSelection();
      sel.modify(alter, dir, granularity);
      const n = sel.focusNode;
      const el = n && (n.nodeType === 3 ? n.parentElement : n);
      const container = document.getElementById("nonstop-container");
      const group = el && el.closest ? el.closest(".nonstop-text-group") : null;
      return {
        inTextLayer: el && el.closest ? !!el.closest(".nonstop-text-layer") : false,
        page: group ? group.dataset.page : null,
        top: el && el.getBoundingClientRect
          ? el.getBoundingClientRect().top + container.scrollTop : null,
        len: sel.toString().length,
      };
    },
  };
`;

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

test("PDF responses are intercepted and replaced with the viewer shell", async () => {
  await driver.get(fixtureUrl("test-links.pdf"));
  await driver.wait(async () => {
    return await driver.executeScript(
      `return !!document.getElementById("nonstop-container");`
    ).catch(() => false);
  }, 15000, "viewer shell did not appear");
  const shell = await driver.executeScript(`
    return {
      contentType: document.contentType,
      hasContainer: !!document.getElementById("nonstop-container"),
      pdfUrl: window.__nonstopPdfUrl,
      title: document.title,
    };
  `);
  assert.equal(shell.contentType, "text/html");
  assert.ok(shell.hasContainer, "viewer shell missing #nonstop-container");
  assert.equal(shell.pdfUrl, fixtureUrl("test-links.pdf"));
  assert.equal(shell.title, "test-links.pdf");
});

test("viewer renders all pages with text and annotation layers", async () => {
  await openViewer(driver, uuid, "test-links.pdf");
  const counts = await driver.executeScript(`
    return {
      pages: document.querySelectorAll(".nonstop-page").length,
      textLayers: document.querySelectorAll(".nonstop-text-layer").length,
      textGroups: document.querySelectorAll(".nonstop-text-group").length,
      annotationLayers: document.querySelectorAll(".nonstop-annotation-layer").length,
      spans: document.querySelectorAll(".nonstop-text-layer span").length,
      pageCount: document.getElementById("nonstop-page-count").textContent,
    };
  `);
  assert.equal(counts.pages, 5);
  assert.equal(counts.textLayers, 1, "expected one shared document-wide text layer");
  assert.equal(counts.textGroups, 5);
  assert.equal(counts.annotationLayers, 5);
  assert.equal(counts.pageCount, "5");
  assert.ok(counts.spans > 200, "expected dense text layers, got " + counts.spans + " spans");
});

test("text layer keeps spans absolutely positioned and brs in normal flow", async () => {
  // gecko only forms one line box per visual line if the brs are in flow,
  // and only one continuous line-box list if page groups generate no boxes;
  // Selection.modify("line") (Vimium C visual mode j/k) depends on both
  const layout = await driver.executeScript(`
    const group = document.querySelectorAll(".nonstop-text-group")[2];
    const span = group.querySelector("span");
    const br = group.querySelector("br");
    return {
      groupDisplay: getComputedStyle(group).display,
      spanPosition: getComputedStyle(span).position,
      brPosition: br ? getComputedStyle(br).position : null,
      brCount: group.querySelectorAll("br").length,
    };
  `);
  assert.equal(layout.groupDisplay, "contents");
  assert.equal(layout.spanPosition, "absolute");
  assert.equal(layout.brPosition, "static");
  assert.ok(layout.brCount > 15, "expected one br per text line, got " + layout.brCount);
});

test("line-granularity selection moves line by line (visual mode j/k)", async () => {
  await driver.executeScript(INSTALL_PAGE_HELPERS);
  const startTop = await driver.executeScript(`return window.__t.caretOnPage(2, 8, 1);`);

  let prevTop = startTop;
  for (let i = 0; i < 3; i++) {
    const s = await driver.executeScript(`return window.__t.modifyStep("extend", "forward", "line");`);
    assert.ok(s.inTextLayer, "step " + i + ": selection focus escaped the text layer");
    const delta = s.top - prevTop;
    assert.ok(delta > 2 && delta < 40,
      "step " + i + ": expected one-line move, focus moved " + delta.toFixed(1) + "px");
    prevTop = s.top;
  }

  await driver.executeScript(`return window.__t.caretOnPage(2, 8, 1);`);
  prevTop = startTop;
  for (let i = 0; i < 2; i++) {
    const s = await driver.executeScript(`return window.__t.modifyStep("extend", "backward", "line");`);
    assert.ok(s.inTextLayer, "backward step " + i + ": selection focus escaped the text layer");
    const delta = prevTop - s.top;
    assert.ok(delta > 2 && delta < 40,
      "backward step " + i + ": expected one-line move, focus moved " + delta.toFixed(1) + "px");
    prevTop = s.top;
  }
});

test("line selection crosses page boundaries (visual mode j/k over pages)", async () => {
  await openViewer(driver, uuid, "test-links.pdf");
  await driver.executeScript(INSTALL_PAGE_HELPERS);

  // caret on the last text line of page 2, then extend forward until page 3
  let prevTop = await driver.executeScript(`return window.__t.caretOnPage(1, -1, 1);`);
  let page = "2";
  for (let i = 0; i < 4 && page !== "3"; i++) {
    const s = await driver.executeScript(`return window.__t.modifyStep("extend", "forward", "line");`);
    assert.ok(s.inTextLayer, "step " + i + ": selection focus escaped the text layer");
    const delta = s.top - prevTop;
    assert.ok(delta > 2 && delta < 400,
      "step " + i + ": expected a line (or page-gap) move, focus moved " + delta.toFixed(1) + "px");
    prevTop = s.top;
    page = s.page;
  }
  assert.equal(page, "3", "forward line selection never reached page 3");

  // and back over the boundary
  for (let i = 0; i < 4 && page !== "2"; i++) {
    const s = await driver.executeScript(`return window.__t.modifyStep("extend", "backward", "line");`);
    assert.ok(s.inTextLayer, "backward step " + i + ": selection focus escaped the text layer");
    page = s.page;
  }
  assert.equal(page, "2", "backward line selection never returned to page 2");
});

test("character and word selection still work", async () => {
  await driver.executeScript(INSTALL_PAGE_HELPERS);
  await driver.executeScript(`return window.__t.caretOnPage(2, 8, 1);`);
  const ch = await driver.executeScript(`return window.__t.modifyStep("extend", "forward", "character");`);
  assert.equal(ch.len, 1);
  const word = await driver.executeScript(`return window.__t.modifyStep("extend", "forward", "word");`);
  assert.ok(word.len > 1 && word.len < 30, "word step selected " + word.len + " chars");
});

test("word selection across a line break keeps the caret rect on the line (visual mode w)", async () => {
  await driver.executeScript(INSTALL_PAGE_HELPERS);
  const startTop = await driver.executeScript(`return window.__t.caretEndOfLine(1, 5);`);

  // step over the line break word by word; each step's focus caret rect must
  // stay near the current line, or Vimium C's scroll-into-view jumps wildly
  let prevTop = startTop;
  let crossed = false;
  for (let i = 0; i < 6; i++) {
    const s = await driver.executeScript(`return window.__t.wordStep();`);
    const delta = s.top - prevTop;
    assert.ok(Math.abs(delta) < 150,
      "step " + i + " (focus on " + s.node + "): caret rect jumped " + delta.toFixed(1) + "px");
    if (delta > 3) crossed = true;
    prevTop = s.top;
  }
  assert.ok(crossed, "word stepping never crossed onto the next line");
});

test("link annotations render as positioned overlays", async () => {
  const links = await driver.executeScript(`
    const links = [...document.querySelectorAll(".nonstop-annotation-layer a")];
    const ext = links.filter(a => /^https?:/.test(a.href));
    const page = document.querySelector(".nonstop-page").getBoundingClientRect();
    const r = links[0].getBoundingClientRect();
    return {
      total: links.length,
      internal: links.filter(a => a.getAttribute("href") === "#").length,
      external: ext.map(a => ({ href: a.href, target: a.target, rel: a.rel })),
      firstRect: { w: r.width, h: r.height, insidePage: r.left >= page.left && r.right <= page.right },
    };
  `);
  assert.equal(links.total, 9, "test-links.pdf has 9 link annotations");
  assert.equal(links.internal, 8);
  assert.deepEqual(links.external, [
    { href: "https://example.com/", target: "_blank", rel: "noopener noreferrer" },
  ]);
  assert.ok(links.firstRect.w > 5 && links.firstRect.h > 3, "link overlay has no size");
  assert.ok(links.firstRect.insidePage, "link overlay outside page bounds");
});

test("internal links navigate to their destination", async () => {
  const nav = await driver.executeScript(`
    const container = document.getElementById("nonstop-container");
    container.scrollTop = 0;
    const link = [...document.querySelectorAll(".nonstop-annotation-layer a")]
      .find(a => a.getAttribute("href") === "#");
    link.click();
    return new Promise(res => setTimeout(() => {
      res({
        page: document.getElementById("nonstop-page-input").value,
        scrollTop: container.scrollTop,
      });
    }, 800));
  `);
  assert.notEqual(nav.page, "1", "clicking a TOC link should leave page 1");
  assert.ok(nav.scrollTop > 0, "container did not scroll");
});

test("internal links center the exact destination in the viewport", async () => {
  const r = await driver.executeScript(`
    const container = document.getElementById("nonstop-container");
    container.scrollTop = 0;
    // topmost internal link on page 2 (annotation order is not reading order):
    // the pageref to the mid-page "Key finding" paragraph on page 4
    const link = [...document.querySelectorAll(".nonstop-page")[1]
      .querySelectorAll('.nonstop-annotation-layer a[href="#"]')]
      .sort((a, b) => {
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        return Math.abs(ra.top - rb.top) > 3 ? ra.top - rb.top : ra.left - rb.left;
      })[0];
    link.click();
    return new Promise(res => setTimeout(() => {
      const target = [...document.querySelectorAll('.nonstop-text-group[data-page="4"] span')]
        .find(s => s.textContent.includes("Key finding"));
      const page4 = document.querySelectorAll(".nonstop-page")[3];
      res({
        scrollTop: container.scrollTop,
        clientHeight: container.clientHeight,
        targetTop: target ? target.getBoundingClientRect().top + container.scrollTop : null,
        pageTop: page4.getBoundingClientRect().top + container.scrollTop,
      });
    }, 800));
  `);
  assert.ok(r.targetTop !== null, "'Key finding' span not found on page 4");
  assert.ok(r.targetTop - r.pageTop > 100, "fixture issue: target is not mid-page");
  const offset = r.targetTop - r.scrollTop;
  assert.ok(Math.abs(offset - r.clientHeight / 2) < 100,
    "expected the destination near the viewport middle, got " + offset.toFixed(1) +
    "px from the top of a " + r.clientHeight + "px viewport");
});

test("outline sidebar lists sections and navigates", async () => {
  const outline = await driver.executeScript(`
    const entries = [...document.querySelectorAll("#nonstop-outline a")];
    if (!entries.length) return { entries: 0 };
    const container = document.getElementById("nonstop-container");
    container.scrollTop = 0;
    entries[entries.length - 1].click();
    return new Promise(res => setTimeout(() => {
      res({
        entries: entries.length,
        titles: entries.map(a => a.textContent),
        page: document.getElementById("nonstop-page-input").value,
      });
    }, 800));
  `);
  assert.equal(outline.entries, 4);
  assert.deepEqual(outline.titles, ["Introduction", "Methods", "Results", "Conclusion"]);
  assert.notEqual(outline.page, "1", "clicking the last outline entry should navigate");
});

test("zoom re-renders text and link layers in sync", async () => {
  // reload to a clean state at default zoom
  await openViewer(driver, uuid, "test-links.pdf");
  const zoom = await driver.executeScript(`
    const layer = document.querySelectorAll(".nonstop-annotation-layer")[0];
    const linkBefore = layer.querySelector("a").getBoundingClientRect().width;
    const spanBefore = document.querySelector(".nonstop-text-layer span").getBoundingClientRect().width;
    const sel = document.getElementById("nonstop-zoom-select");
    sel.value = "2";
    sel.dispatchEvent(new Event("change"));
    return new Promise(res => setTimeout(() => {
      res({
        linkRatio: layer.querySelector("a").getBoundingClientRect().width / linkBefore,
        spanRatio: document.querySelector(".nonstop-text-layer span").getBoundingClientRect().width / spanBefore,
      });
    }, 1500));
  `);
  assert.ok(zoom.linkRatio > 1.5, "link overlay did not scale with zoom");
  assert.ok(Math.abs(zoom.linkRatio - zoom.spanRatio) < 0.05,
    "link and text layers scaled differently: " + zoom.linkRatio + " vs " + zoom.spanRatio);
});

test("toolbar page navigation works", async () => {
  await openViewer(driver, uuid, "test-links.pdf");
  const nav = await driver.executeScript(`
    document.getElementById("nonstop-next").click();
    return new Promise(res => setTimeout(() => {
      const afterNext = document.getElementById("nonstop-page-input").value;
      document.getElementById("nonstop-prev").click();
      setTimeout(() => {
        res({ afterNext, afterPrev: document.getElementById("nonstop-page-input").value });
      }, 300);
    }, 300));
  `);
  assert.equal(nav.afterNext, "2");
  assert.equal(nav.afterPrev, "1");
});
