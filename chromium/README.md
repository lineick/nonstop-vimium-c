# Chromium preview

The Chromium preview runs Nonstop's PDF viewer with the installed Vimium C's
mappings and tab search. It requires Chromium 151+ and the Chrome Web Store
distribution of Vimium C 2.12.2. It has been tested with Helium, based on
Chromium 157.0.8103.38.

## Prepare and load the extension

First, install Vimium C 2.12.2 and locate its installed directory. The directory
must contain `manifest.json`, `content/`, and `lib/`. Then run:

```sh
./setup.sh
uv run chromium/package.py --vimium-dir /path/to/vimium-c/2.12.2_0
```

The command creates `dist/chromium/`, including PDF.js and the matching Vimium C
page scripts. The generated files are ignored by Git. The scripts retain
Vimium C's license and a notice describing the injector modification.

Open the browser's extension manager at `chrome://extensions`, enable developer
mode, and load `dist/chromium/` as an unpacked extension. Copy its extension ID
into Vimium C's advanced extension allowlist, then reload existing PDF tabs.
The viewer displays setup instructions if the allowlist entry is missing.

The browser chooses the most recently installed handler when several
extensions register for PDFs. See the [browser API documentation](https://developer.chrome.com/docs/extensions/reference/api/mimeHandler#register-a-handler).

## Implementation and maintenance

The preview uses the browser's PDF handler API to read the received document
stream. It preserves the original URL and also handles local files. Download
saves the received bytes, and the native viewer button hands the document back
to the browser's PDF viewer.

Manifest V3 blocks Vimium C's usual loader from importing another extension's
scripts. The package therefore includes Vimium C's page scripts and changes
its injector to load them from the package. Those scripts connect to the
installed Vimium C backend, which supplies the mappings, commands, and tab
search. The package does not copy the backend or the user's settings.

The packaged scripts must match the installed backend. The packager currently
accepts only version 2.12.2, and the viewer reports a version mismatch after a
Vimium C update. Supporting other versions requires reviewing the injector and
repeating the browser tests. An upstream contribution needs agreement on how
to maintain that dependency.

## Current limits

The preview handles PDFs opened as tabs. Embedded documents, the Firefox
settings page, and new-tab redirection are not ported. Keyboard zoom uses the
default step, and zoom is not remembered because Chromium's PDF handler frames
cannot access sessionStorage. Authenticated and password-protected documents
have not been tested in Chromium. The normal Firefox package still uses the
existing manifest, background script, and settings page.

## Validate with Helium

The test below packages the extension and launches the supplied Helium binary
headlessly. It copies Vimium C into a temporary directory and uses isolated
browser profiles, so it does not change the normal browser profile.

```sh
uv run tests/chromium.py \
  --browser /Applications/Helium.app/Contents/MacOS/Helium \
  --vimium-dir /path/to/vimium-c/2.12.2_0 \
  --artifacts /tmp/nonstop-chromium-evidence
```

The test exercises HTTP and local PDFs, scrolling, a custom mapping supplied
by Vimium C, link hints, tab search and selection, download contents, and the
native viewer button. It also checks missing allowlist entries and backend
version mismatches. The output directory contains before/after screenshots and
a JSON result file. Playwright is installed through the test's pinned uv
script dependency.

## References

The implementation follows the [browser PDF handler API](https://developer.chrome.com/docs/extensions/reference/api/mimeHandler)
and Vimium C's [extension injection protocol](https://github.com/gdh1995/vimium-c/wiki/Inject-into-other-extensions).
The [Manifest V3 script policy](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy)
explains why scripts must be packaged locally.
