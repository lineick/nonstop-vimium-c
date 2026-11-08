"use strict";

const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { Builder } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const { start } = require("geckodriver");

const ROOT = path.resolve(__dirname, "..");
let server, driver, gecko, baseUrl;

before(async () => {
  // Exercise the production viewer over HTTP without a privileged extension
  // navigation. These tests cover gestures/layout, not PDF interception.
  server = http.createServer((req, res) => {
    const file = path.resolve(ROOT, "." + new URL(req.url, "http://localhost").pathname);
    const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".pdf": "application/pdf" };
    if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  baseUrl = "http://127.0.0.1:" + server.address().port;
  gecko = await start({ port: 4472 });
  const opts = new firefox.Options().addArguments("-headless");
  if (process.env.FIREFOX_BINARY) opts.setBinary(process.env.FIREFOX_BINARY);
  driver = await new Builder().forBrowser("firefox").setFirefoxOptions(opts)
    .usingServer("http://127.0.0.1:4472").build();
  await driver.manage().window().setRect({ width: 1200, height: 800 });
});

after(async () => {
  if (driver) await driver.quit();
  if (gecko) gecko.kill();
  if (server) server.close();
});

beforeEach(async () => {
  await driver.get(baseUrl + "/pdf/viewer-page.html?file=" +
    encodeURIComponent(baseUrl + "/tests/fixtures/test-links.pdf"));
  await driver.wait(() => driver.executeScript(`
    return document.querySelectorAll(".nonstop-text-group span").length > 200;
  `), 15000);
  await driver.executeScript(`
    const select = document.getElementById("nonstop-zoom-select");
    select.value = "1";
    select.dispatchEvent(new Event("change"));
  `);
  await driver.executeAsyncScript(`
    requestAnimationFrame(() => requestAnimationFrame(arguments[arguments.length - 1]));
  `);
});

async function wheel(deltaY, count = 1, deltaMode = 0, ctrlKey = true) {
  return driver.executeAsyncScript(`
    const [deltaY, count, deltaMode, ctrlKey, done] = arguments;
    const container = __nonstopViewer.container;
    const rect = container.getBoundingClientRect();
    let prevented = false;
    for (let i = 0; i < count; i++) {
      const event = new WheelEvent("wheel", {
        deltaY, deltaMode, ctrlKey, bubbles: true, cancelable: true,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
      });
      container.dispatchEvent(event);
      prevented = event.defaultPrevented;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      done({ scale: __nonstopViewer.scale, prevented });
    }));
  `, deltaY, count, deltaMode, ctrlKey);
}

test("tiny pinch movements scale proportionally and reverse", async () => {
  const tiny = await wheel(-0.01, 10);
  assert.ok(Math.abs(tiny.scale - Math.exp(0.001)) < 1e-9, JSON.stringify(tiny));
  assert.equal(tiny.prevented, true);
  const reversed = await wheel(0.01, 10);
  assert.ok(Math.abs(reversed.scale - 1) < 1e-9);
  const small = await wheel(-1);
  const large = await wheel(-10);
  assert.ok(Math.abs(small.scale - Math.exp(0.01)) < 1e-9);
  assert.ok(Math.abs(large.scale - Math.exp(0.11)) < 1e-9);
});

test("one gesture has the same scale whether events arrive in one frame or several", async () => {
  const batched = await wheel(-1, 10);
  await wheel(1, 10);
  let split;
  for (let i = 0; i < 10; i++) split = await wheel(-1);
  assert.ok(Math.abs(batched.scale - split.scale) < 1e-9);
});

test("pinch preserves the PDF point under the cursor on a later page", async () => {
  const result = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    const container = __nonstopViewer.container;
    const select = document.getElementById("nonstop-zoom-select");
    select.value = "2";
    select.dispatchEvent(new Event("change"));
    requestAnimationFrame(() => {
      const page = document.querySelectorAll(".nonstop-page")[2];
      container.scrollTop = page.offsetTop + 300;
      container.scrollLeft = 100;
      const bounds = container.getBoundingClientRect();
      const x = bounds.left + bounds.width * 0.6;
      const y = bounds.top + bounds.height * 0.4;
      const before = page.getBoundingClientRect();
      const px = (x - before.left) / __nonstopViewer.scale;
      const py = (y - before.top) / __nonstopViewer.scale;
      container.dispatchEvent(new WheelEvent("wheel", {
        deltaY: -10, deltaMode: 0, ctrlKey: true, cancelable: true,
        clientX: x, clientY: y,
      }));
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const after = page.getBoundingClientRect();
        done({ xError: after.left + px * __nonstopViewer.scale - x,
          yError: after.top + py * __nonstopViewer.scale - y });
      }));
    });
  `);
  assert.ok(Math.abs(result.xError) <= 1, JSON.stringify(result));
  assert.ok(Math.abs(result.yError) <= 1, JSON.stringify(result));
});

test("zoom limits release immediately when the gesture reverses", async () => {
  assert.equal((await wheel(-10000)).scale, 5);
  assert.ok((await wheel(1)).scale < 5);
  assert.equal((await wheel(10000)).scale, 0.1);
  assert.ok((await wheel(-1)).scale > 0.1);
});

test("ordinary wheel scrolling, line-wheel zoom and keyboard steps are preserved", async () => {
  assert.deepEqual(await wheel(-1, 1, 0, false), { scale: 1, prevented: false });
  assert.equal((await wheel(0)).scale, 1);
  assert.equal((await wheel(-1, 1, 1)).scale, 1.1);
  assert.equal((await wheel(1, 1, 1)).scale, 0.9);
  const scale = await driver.executeScript(`
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true }));
    return __nonstopViewer.scale;
  `);
  assert.equal(scale, 1.4);
});

test("an explicit zoom command supersedes a queued pinch", async () => {
  const scale = await driver.executeAsyncScript(`
    const done = arguments[arguments.length - 1];
    __nonstopViewer.container.dispatchEvent(new WheelEvent("wheel", {
      deltaY: -10, deltaMode: 0, ctrlKey: true, cancelable: true,
    }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true }));
    requestAnimationFrame(() => requestAnimationFrame(() => done(__nonstopViewer.scale)));
  `);
  assert.equal(scale, 1.5);
});
