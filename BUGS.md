# Known Bugs

## Vertical selection in Vimium C visual mode (`j`/`k`) does not work correctly

### Symptom

In Vimium C's visual mode, horizontal selection (`h`, `l`) and word-wise selection (`w`) work correctly. However, pressing `j` (select down one line) or `k` (select up one line) causes the selection to jump far outside the visible area, often selecting the entire remainder of the page and scrolling to the bottom or top. Repeated presses make it worse. Mouse-based text selection works fine.

When zoomed in, `w` also briefly scrolls the view away from the selection before snapping back, though the selection itself remains correct. `j` and `k` do not recover — the selection is broken.

### Root Cause

Vimium C implements vertical line selection in visual mode by calling the browser's native [`Selection.prototype.modify()`](https://developer.mozilla.org/en-US/docs/Web/API/Selection/modify) with `"line"` granularity (e.g. `sel.modify("extend", "forward", "line")`). This is the standard DOM API for moving a selection by one line.

The problem is that **Firefox's implementation of `sel.modify("line")` does not work correctly with absolutely-positioned text elements**, which is how PDF.js (and this extension's) text layer is structured. Each text span in the PDF text layer is positioned with `position: absolute` and a CSS `transform` (translate + rotate + scaleX) to match the rendered PDF layout pixel-perfectly. Firefox's line-detection heuristic does not understand this layout — it sees all the spans as being at unrelated positions and jumps to unpredictable locations, often selecting the entire page content in one step.

This is a **Firefox browser engine limitation**, not a bug in Vimium C or in this extension. Chromium handles `sel.modify("line")` on absolutely-positioned text more gracefully, which is why the Chromium version of Vimium C's PDF viewer does not have this issue.

### Why it cannot be fixed from this extension

Several approaches were attempted and all failed due to fundamental architectural constraints in Firefox:

1. **Override `Selection.prototype.modify` in page script context** (`vimium-bridge.js`): The override was applied in the page's JavaScript world. However, Vimium C runs in a **content script context**, and Firefox's [Xray wrappers](https://firefox-source-docs.mozilla.org/dom/scriptSecurity/xray_vision.html) ensure that each extension's content script sees the **original, unmodified** `Selection.prototype`. Overrides made in the page world (or by another extension) are invisible to Vimium C's content script. The override was never called.

2. **Override `Selection.prototype.modify` in a content script** (`content-script.js`): A content script from *this* extension was created to override the prototype, hoping that extensions share content script prototypes. They do not — **Firefox isolates content script prototypes between different extensions**. Vimium C's content script still saw the original, unmodified `Selection.prototype.modify`. The override was never called.

3. **Intercept `j`/`k` keydown events before Vimium C sees them**: A capturing `keydown` listener was added with `stopImmediatePropagation()` to block `j`/`k` and substitute custom selection logic. However, **Vimium C registers its own capturing listeners first** (it loads before our content script) and calls `stopImmediatePropagation()` itself. Our listener never fired for `j`/`k` — Vimium C consumed them before we could intercept.

4. **Restructure the text layer DOM to use inline flow layout**: The text layer was restructured to use inline `<span>` elements with `<br>` line separators and `transform: translate()` for visual positioning, instead of `position: absolute`. The theory was that `sel.modify("line")` would work on inline flow content. It did not — Firefox still could not determine line boundaries correctly when CSS transforms are involved. The selection still jumped across the entire page.

5. **Detect and correct broken selections via `selectionchange` event**: A `selectionchange` listener was added to detect when `sel.modify("line")` caused the selection to jump too far (using `getBoundingClientRect()` distance checks), restore the previous selection, and apply a manual line-boundary workaround. This partially worked but caused **visible flicker** (the broken selection appears for one frame before correction) and was **unreliable on repeated presses** — the detection heuristic could not reliably distinguish intentional large selections from broken ones, causing the selection to eventually escape again.

6. **Remap `j`/`k` to equivalent multi-step visual mode commands**: Instead of `sel.modify("line")`, `j` was remapped to the equivalent of `$w` (end of line + next word) and `k` to `o0bo` (swap anchor + beginning of line + back one word + swap anchor). These compound operations avoid `sel.modify("line")` entirely. However, since none of the interception methods (prototype override, event capture) could actually reach Vimium C's execution context, the remapping could never be applied.

### What would fix it

The bug can only be fixed by modifying **Vimium C itself** or the **Firefox browser engine**:

- **Vimium C source patch**: Locate the `sel.modify("extend", "forward", "line")` calls in Vimium C's visual mode handler and replace them with a workaround that uses `"lineboundary"` + `"word"/"character"` granularity instead, which Firefox handles correctly even with absolutely-positioned text. Since Vimium C runs in its own isolated content script context, only changes within that context take effect.

- **Vimium C configuration**: As of the current version, Vimium C's `map`/`runKey` configuration does not support mode-specific (visual-mode-only) key remapping, so `j`/`k` cannot be remapped only in visual mode without affecting normal mode navigation.

- **Firefox engine fix**: If Firefox's `Selection.prototype.modify` were improved to correctly handle line detection across absolutely-positioned or CSS-transformed elements, the issue would resolve itself for all extensions.

---

## PDF internal links (annotations) do not work

### Symptom

Internal PDF links (e.g., "Figure 1", table of contents entries, cross-references) are not clickable. The blue coloring visible on some link text is just the PDF's own rendering on the canvas — it is not produced by any link detection. Non-colored links show no indication at all. The annotation layer does not appear to detect or render any link elements.

The outline/sidebar links work fine (those use a separate code path via `pdfDoc.getOutline()`).

### What was investigated

Two approaches were tried. Neither produced clickable (or even detectable) link elements in the DOM.

#### 1. Built-in `pdfjsLib.AnnotationLayer`

The bundled `pdf.min.js` (pdfjs-dist v3.11.174) exports `AnnotationLayer` as a class. Usage:

```javascript
var layer = new pdfjsLib.AnnotationLayer({
  div: annotationDiv, page: pageProxy, viewport: viewport,
});
layer.render({
  annotations: annotations,  // from page.getAnnotations()
  linkService: linkService,
  renderForms: false,
});
```

**Findings from analyzing the minified source:**

- `AnnotationLayer.render()` is `async` but all DOM operations happen **synchronously** before the only `await` (i18n translation).
- `LinkAnnotationElement.render()` is synchronous. For internal GoTo links it calls `_bindLink(link, dest)` which sets `link.onclick = () => { linkService.goToDestination(dest); return false; }`.
- The library requires a `linkService` object with methods: `getDestinationHash`, `goToDestination`, `addLinkAttributes`, `getAnchorUrl`, `executeNamedAction`, and properties: `externalLinkTarget`, `externalLinkRel`, `externalLinkEnabled`.
- Missing `addLinkAttributes` on the linkService caused a silent TypeError that aborted all annotation rendering — this was one early failure.
- `setLayerDimensions()` (called internally by `render()`) sets the annotation layer div's dimensions using `var(--scale-factor)` CSS custom property. Without this variable defined, the layer collapses to 0×0 and all percentage-based child positions resolve to zero. Setting `--scale-factor` to `currentScale` was required but did not fix the core problem.

**Result:** No `<section>` or `<a>` elements were observed in the DOM after `render()` completed. The annotation layer remained empty despite `page.getAnnotations()` returning data. The built-in AnnotationLayer silently produced no output.

#### 2. Manual fallback rendering

A manual approach was also tried:
- Calls `page.getAnnotations()` and filters for `subtype === "Link"`
- Transforms PDF rectangle coordinates to viewport pixels using the viewport transform matrix
- Creates `<a>` elements with explicit positions, dimensions, `pointer-events: auto`, and click handlers

**Result:** Same outcome — while the code ran without errors, the rendered links had no visible effect. It's unclear whether `page.getAnnotations()` returns valid link annotation data for the test PDFs, or whether the annotation data lacks `dest`/`url`/`action` properties needed for navigation.

#### 3. Architecture (not the cause)

The viewer's HTML injection via `filterResponseData` was verified to have no restrictions that would prevent links:
- No CSP (headers are stripped)
- No iframe, shadow DOM, or sandbox
- No click event interception on the container

### Root cause (likely)

The most probable explanation is that `page.getAnnotations()` either returns no link annotations, or returns annotations without the `dest`/`url`/`action` properties needed to create clickable elements. This could be because:

1. The test PDFs use a link format that pdf.js v3.11.174 doesn't expose through `getAnnotations()`
2. The annotations are present but are silently skipped by `AnnotationLayer.render()` due to a missing or misconfigured parameter
3. The PDF's link-like text (blue, underlined) may not actually have annotation objects — some PDFs style text to look like links without embedding actual link annotations

### Suggested next steps

1. **Log the raw annotation data** to see what `page.getAnnotations()` actually returns:
   ```javascript
   page.getAnnotations().then(function (annots) {
     console.log("Page annotations:", JSON.stringify(annots, null, 2));
   });
   ```
   Check whether any annotations have `subtype: "Link"` and whether they have `dest`, `url`, or `action` properties.

2. **Test with a known-good PDF** that has verified GoTo link annotations (e.g., a PDF with a table of contents that links to sections). The pdf.js demo site can be used to verify that a PDF's links work with the same library version.

3. **Compare with the official pdf.js viewer** — open the same PDF in Firefox's built-in viewer (which uses pdf.js) and check if links work there. If they don't, the PDF itself lacks link annotations.
