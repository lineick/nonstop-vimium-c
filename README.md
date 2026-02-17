# Nonstop Vimium C

![](icons/icon.png | width=100)

Never interrupt your Vimium C workflow again! This Firefox extension ensures that Vimium C works flawlessly within the **PDF viewer**.

Vibecoded with Claude. 

Known bugs: Vertical selection (`j`/`k`) in visual mode does not work correctly — see [BUGS.md](BUGS.md) for details.

## Motivation

Firefox blocks extensions from running in its built-in PDF viewer (`resource://pdf.js/`). This means Vimium C keyboard shortcuts don't work when viewing documents. Nonstop Vimium C fixes this by providing a compatible environment for the extension to inject into.

## Features

### PDF Viewer

Replaces Firefox's built-in PDF viewer with a custom viewer that supports Vimium C shortcuts. Uses Firefox's `filterResponseData()` API to replace PDF responses while keeping the original URL, so Vimium C injects naturally.

The PDF viewer includes:

* **Continuous scroll** with lazy page rendering
* **Zoom controls** (fit-to-width, fit-to-page, manual zoom, Ctrl+scroll)
* **Text selection** and browser find (Ctrl+F)
* **Document outline/bookmarks** sidebar
* **Password-protected** PDF support
* **Download** and open in Firefox's native PDF viewer
* **High-DPI / Retina** display support

## Prerequisites

* Firefox 142+
- [Vimium C](https://addons.mozilla.org/en-US/firefox/addon/vimium-c/) installed

## Development Setup

```bash
# Download PDF.js library files (requires curl)
./setup.sh

```

### Temporary Installation (for development)

1. Run `./setup.sh` to download PDF.js
2. Open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on..."
4. Select the `manifest.json` file

## Configuration

Open the extension options (right-click extension icon > "Manage Extension" > "Options") to configure:

* **PDF Viewer**: Enable or disable the PDF viewer replacement.

## How It Works

When Firefox receives a PDF response, this extension:

1. Intercepts the response via `webRequest.onHeadersReceived`.
2. Uses `filterResponseData()` to replace the PDF binary with viewer HTML.
3. The viewer HTML loads PDF.js from the extension's bundled files.
4. The PDF is re-fetched from the original URL by the viewer.
5. Since the page URL remains unchanged, Vimium C injects normally.
6. A bridge script adapts Vimium C's scroll and mark functions for the PDF viewer.

For `file://` PDFs, the extension redirects to its own viewer page since `filterResponseData()` doesn't apply to `file://` URLs.

## Permissions

* **`storage`**: Save user preferences.
* **`webRequest` / `webRequestBlocking**`: Intercept PDF responses to replace with the custom viewer.
* **`<all_urls>`**: Needed to intercept PDF responses on any website.

## License

MIT

