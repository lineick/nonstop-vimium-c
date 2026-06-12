# Tests

End-to-end tests that drive the extension in a real (headless) Firefox via
Selenium/geckodriver.

## Requirements

* Node.js 20+ (uses the built-in `node --test` runner)
* Firefox installed on `$PATH`
* `zip` (used to package the extension for a temporary install)
* `pdf/lib/` populated (`../setup.sh`)

## Run

```bash
cd tests
npm install
npm test
```

Set `HEADED=1` to watch the browser.

## What is covered

* PDF response interception produces the viewer shell (background.js)
* Page, text layer, and annotation layer rendering
* Text layer structure: one shared document-wide layer, `display: contents`
  page groups, absolutely-positioned spans with in-flow `<br>`s — the
  invariants that make `Selection.modify(..., "line")` (Vimium C visual mode
  `j`/`k`) work; regression tests move the selection line by line, including
  across page boundaries, and check the caret rect while word-stepping
  (`w`) across a line break
* Link annotations: overlay geometry, external link attributes, internal
  link navigation, centered scrolling to mid-page `XYZ` destinations
* Outline sidebar navigation
* Zoom re-rendering keeps text and link layers in sync
* Toolbar page navigation
* Progressive rendering (`perf.test.js`, against a 120-page fixture):
  the first page is interactive before the document-order background fill
  completes, scrolled-to pages render out of order via the
  IntersectionObserver, and zoom clears all groups synchronously (no
  stale-scale spans in the shared layer) before refilling lazily

## Caveats

* Under a geckodriver *temporary* install, `moz-extension://` scripts
  referenced by intercepted `http(s)` pages do not execute (they do for the
  signed release build). The interception test therefore only asserts the
  injected HTML shell, and the viewer itself is exercised through the
  extension's `pdf/viewer-page.html?file=` route, which runs the identical
  `viewer.js`/`viewer.css` code.
* `fixtures/test-links.pdf` is generated from `fixtures/test-links.tex`
  (`pdflatex test-links.tex`, run twice). It contains a linked table of
  contents, internal cross-references (including one to a mid-page target,
  used by the destination-precision test), an external link, and a PDF
  outline.
* `fixtures/lipsum-120.pdf` (120 pages of plain text, used by `perf.test.js`)
  is generated from `fixtures/lipsum-120.tex` (`pdflatex lipsum-120.tex`,
  single pass).
* The two test files share hardcoded geckodriver/fixture-server ports, so the
  npm script runs them sequentially (`--test-concurrency=1`).
