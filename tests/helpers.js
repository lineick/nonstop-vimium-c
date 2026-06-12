"use strict";

const { execSync } = require("child_process");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { Builder } = require("selenium-webdriver");
const firefox = require("selenium-webdriver/firefox");
const { start } = require("geckodriver");

const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(__dirname, "fixtures");
const GECKODRIVER_PORT = 4471;
const SERVER_PORT = 8731;

function buildExtensionZip() {
  const out = path.join(os.tmpdir(), "nonstop-vimium-c-test.zip");
  fs.rmSync(out, { force: true });
  execSync(
    "zip -qr " + JSON.stringify(out) + " manifest.json background.js options pdf icons",
    { cwd: ROOT }
  );
  return out;
}

// serves tests/fixtures/* as application/pdf
function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const file = path.join(FIXTURES, req.url.replace(/^\//, "").split("?")[0]);
    try {
      const data = fs.readFileSync(file);
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end(data);
    } catch (e) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(SERVER_PORT);
  return server;
}

async function startBrowser() {
  const gecko = await start({ port: GECKODRIVER_PORT });
  const opts = new firefox.Options();
  if (process.env.HEADED !== "1") opts.addArguments("-headless");
  const driver = await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(opts)
    .usingServer("http://127.0.0.1:" + GECKODRIVER_PORT)
    .build();
  await driver.installAddon(buildExtensionZip(), true);
  await driver.sleep(1500);
  return { driver, gecko };
}

function fixtureUrl(name) {
  return "http://127.0.0.1:" + SERVER_PORT + "/" + name;
}

// the extension's internal moz-extension://<uuid> origin is random per install;
// recover it from the script tags of an intercepted PDF page
async function discoverExtensionUuid(driver) {
  await driver.get(fixtureUrl("test-links.pdf"));
  await driver.sleep(1000);
  const uuid = await driver.executeScript(`
    const s = document.querySelector('script[src^="moz-extension"]');
    return s ? new URL(s.src).host : null;
  `);
  if (!uuid) throw new Error("extension did not intercept the PDF response");
  return uuid;
}

// note: under a geckodriver temporary install, moz-extension scripts referenced
// by intercepted http pages do not execute (they do for the signed release
// build). the viewer is therefore exercised through its viewer-page.html
// route, which runs the identical viewer.js/viewer.css code
async function openViewer(driver, uuid, pdfName) {
  await driver.get(
    "moz-extension://" + uuid + "/pdf/viewer-page.html?file=" +
    encodeURIComponent(fixtureUrl(pdfName))
  );
  // layers fill progressively after open; these tests assert whole-document
  // state, so wait for the background fill to finish (assumes every fixture
  // page has text). laziness itself is covered by perf.test.js
  await driver.wait(async () => {
    return await driver.executeScript(`
      const groups = [...document.querySelectorAll(".nonstop-text-group")];
      return groups.length > 0 &&
             groups.every(g => g.children.length > 0) &&
             document.querySelectorAll(".nonstop-annotation-layer a").length > 0;
    `).catch(() => false);
  }, 30000, "viewer did not finish rendering " + pdfName);
  await driver.sleep(500);
}

module.exports = { startFixtureServer, startBrowser, discoverExtensionUuid, openViewer, fixtureUrl };
