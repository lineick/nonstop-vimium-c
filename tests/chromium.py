# /// script
# requires-python = ">=3.12"
# dependencies = ["playwright==1.64.1"]
# ///
"""Exercise the Chromium package in the supplied browser with an isolated profile."""

from __future__ import annotations

import argparse
import asyncio
import functools
import hashlib
import http.server
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
from typing import cast

from playwright.async_api import BrowserContext, Frame, Page, Worker, async_playwright

ROOT = Path(__file__).resolve().parent.parent
VIMIUM_ID = "hfjbmagddngcpeloejdejnfgbamkjaeg"
FIXTURE = ROOT / "tests/fixtures/test-links.pdf"


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path == "/target.html":
            data = b"<title>Nonstop tab target</title><p>Selected tab</p>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        elif self.path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
        else:
            super().do_GET()

    def log_message(self, format: str, *args: object) -> None:
        pass


async def wait_truth(frame: Frame | Worker, expression: str, arg: object = None) -> None:
    # wait_for_function uses eval inside the page, which extension CSP forbids.
    for _ in range(150):
        if await frame.evaluate(expression, arg):
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"Condition not reached: {expression}")


async def viewer_frame(page: Page) -> Frame:
    for _ in range(150):
        for frame in page.frames:
            if frame.url.endswith("/pdf/viewer-page.html"):
                await wait_truth(frame, "window.__nonstopViewer?.numPages > 0")
                return frame
        await asyncio.sleep(0.1)
    raise AssertionError("The PDF handler did not render")


async def check_keys(context: BrowserContext, url: str) -> tuple[Page, Frame]:
    page = await context.new_page()
    await page.goto(url, wait_until="domcontentloaded")
    frame = await viewer_frame(page)
    await wait_truth(frame, "window.VimiumInjector?.alive === 1")
    assert page.url == url, "Original document URL was lost"
    await page.bring_to_front()
    await frame.locator("#nonstop-container").click(position={"x": 10, "y": 100})
    await page.keyboard.press("Escape")
    await page.keyboard.press("j")
    await wait_truth(frame, "__nonstopViewer.container.scrollTop > 0")
    await asyncio.sleep(0.2)
    before = cast(float, await frame.evaluate("__nonstopViewer.container.scrollTop"))
    await page.keyboard.press("z")
    await wait_truth(frame, "before => __nonstopViewer.container.scrollTop > before", before)
    await page.keyboard.press("f")
    await wait_truth(frame, 'VApi.y().r.querySelectorAll(".LH").length > 0')
    await page.keyboard.press("Escape")
    await page.keyboard.press("Shift+T")
    for _ in range(150):
        omni = next((f for f in page.frames if f.url.endswith("/front/vomnibar.html")), None)
        if omni:
            await omni.locator("input").wait_for(state="visible")
            break
        await asyncio.sleep(0.1)
    else:
        raise AssertionError("Vimium C tab search did not open")
    await omni.locator("input").fill("Nonstop tab target")
    await wait_truth(omni, "document.querySelectorAll('#list .item').length === 1 && document.querySelector('#list .title')?.textContent.includes('Nonstop tab target')")
    return page, frame


async def main(browser: Path, vimium_dir: Path, artifacts: Path) -> None:
    artifacts.mkdir(parents=True, exist_ok=True)
    handler = functools.partial(Handler, directory=str(FIXTURE.parent))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{server.server_port}/test-links.pdf"
    results: list[str] = []
    errors: list[str] = []
    try:
        with tempfile.TemporaryDirectory(prefix="nonstop-chromium-") as temporary:
            work = Path(temporary)
            vimium = work / "vimium-c"
            shutil.copytree(vimium_dir, vimium, ignore=shutil.ignore_patterns("_metadata"))
            extension = work / "extension"
            subprocess.run([sys.executable, str(ROOT / "chromium/package.py"), "--vimium-dir", str(vimium), "--output", str(extension)], check=True)
            async with async_playwright() as p:
                baseline = await p.chromium.launch_persistent_context(
                    str(work / "before"), executable_path=str(browser), headless=True,
                    args=[f"--load-extension={vimium}", f"--disable-extensions-except={vimium}"],
                    viewport={"width": 1280, "height": 900},
                )
                try:
                    page = await baseline.new_page()
                    await page.goto(url, wait_until="domcontentloaded")
                    await asyncio.sleep(1)
                    await page.keyboard.press("Shift+T")
                    assert not any("/front/vomnibar.html" in f.url for f in page.frames)
                    await page.screenshot(path=str(artifacts / "before.png"))
                    results.append("Native PDF viewer does not open Vimium C tab search")
                finally:
                    await baseline.close()
                context = await p.chromium.launch_persistent_context(
                    str(work / "after"), executable_path=str(browser), headless=True,
                    args=[f"--load-extension={vimium},{extension}", f"--disable-extensions-except={vimium},{extension}"],
                    viewport={"width": 1280, "height": 900}, accept_downloads=True,
                )
                try:
                    context.on("weberror", lambda error: errors.append(str(error.error)))
                    version = context.browser.version if context.browser else "unknown"
                    worker = next((w for w in context.service_workers if VIMIUM_ID in w.url), None)
                    if worker is None:
                        worker = await context.wait_for_event("serviceworker", predicate=lambda w: VIMIUM_ID in w.url)
                    await asyncio.sleep(2)  # Allow the fresh Vimium C install to finish its onboarding.
                    await worker.evaluate("async () => { await __moduleMap.settings.vl; __moduleMap.settings.ho('vimSync',false); __moduleMap.settings.ho('extAllowList',''); }")
                    page = await context.new_page()
                    await page.goto(url, wait_until="domcontentloaded")
                    frame = await viewer_frame(page)
                    await frame.locator("dialog").wait_for(state="visible")
                    assert "allowlist" in await frame.locator("dialog").inner_text()
                    extension_id = cast(str, await frame.evaluate("chrome.runtime.id"))
                    await frame.locator("dialog button").click()
                    assert await frame.locator("dialog").count() == 0
                    results.append("Missing allowlist entry displays setup instructions while the PDF renders")
                    await worker.evaluate("id => { __moduleMap.settings.ho('extAllowList',id); __moduleMap.settings.ho('keyMappings','map z scrollDown'); }", extension_id)
                    target = await context.new_page()
                    await target.goto(f"http://127.0.0.1:{server.server_port}/target.html")
                    for document in (url, FIXTURE.as_uri()):
                        page, frame = await check_keys(context, document)
                        if document == url:
                            await page.screenshot(path=str(artifacts / "after.png"))
                        await page.keyboard.press("Enter")
                        await wait_truth(worker, "async () => (await chrome.tabs.query({active:true,lastFocusedWindow:true}))[0]?.title === 'Nonstop tab target'")
                        results.append(f"{document}: original URL, j, backend z mapping, link hints, T filtering and tab selection")
                        await page.bring_to_front()
                        async with page.expect_download() as download_info:
                            await frame.locator("#nonstop-download").click()
                        download = await download_info.value
                        download_path = await download.path()
                        assert download_path and hashlib.sha256(Path(download_path).read_bytes()).digest() == hashlib.sha256(FIXTURE.read_bytes()).digest()
                        results.append(f"{document}: download bytes match the original PDF")
                    await frame.locator("#nonstop-open").click()
                    for _ in range(150):
                        if not any(f.url.endswith("/pdf/viewer-page.html") for f in page.frames):
                            break
                        await asyncio.sleep(0.1)
                    else:
                        raise AssertionError("Native fallback did not unload the custom viewer")
                    for _ in range(150):
                        if any("mhjfbmdgcfjbbpaeojofohoefgiehjai" in f.url for f in page.frames):
                            break
                        await asyncio.sleep(0.1)
                    else:
                        raise AssertionError(f"Native PDF viewer did not attach: {[f.url for f in page.frames]}")
                    results.append("Native viewer button opens the browser PDF viewer")
                    (extension / "vimium.json").write_text(json.dumps({"id": VIMIUM_ID, "version": "0.0.0"}))
                    page = await context.new_page()
                    await page.goto(url, wait_until="domcontentloaded")
                    frame = await viewer_frame(page)
                    await frame.locator("dialog").wait_for(state="visible")
                    assert "requires Vimium C 0.0.0" in await frame.locator("dialog").inner_text()
                    results.append("Backend version mismatch displays an explanation while the PDF renders")
                    assert not errors, errors
                    (artifacts / "results.json").write_text(json.dumps({"browser": str(browser), "version": version, "checks": results, "pageErrors": errors}, indent=2) + "\n")
                    print(json.dumps(results, indent=2))
                finally:
                    await context.close()
    finally:
        server.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", type=Path, required=True)
    parser.add_argument("--vimium-dir", type=Path, required=True)
    parser.add_argument("--artifacts", type=Path, required=True)
    args = parser.parse_args()
    asyncio.run(main(args.browser.resolve(), args.vimium_dir.resolve(), args.artifacts.resolve()))
