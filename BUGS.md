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
