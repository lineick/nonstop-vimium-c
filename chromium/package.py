"""Prepare the experimental Chromium package from matching Vimium C files."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent.parent
VIMIUM_ID = "hfjbmagddngcpeloejdejnfgbamkjaeg"
VIMIUM_VERSION = "2.12.2"


def package(vimium_dir: Path, output: Path) -> Path:
    manifest = json.loads((vimium_dir / "manifest.json").read_text())
    if manifest.get("version") != VIMIUM_VERSION or manifest.get("manifest_version") != 3:
        raise ValueError(f"The preview has only been tested with Vimium C {VIMIUM_VERSION} for Chromium.")
    digest = hashlib.sha256(base64.b64decode(manifest["key"])).hexdigest()[:32]
    extension_id = digest.translate(str.maketrans("0123456789abcdef", "abcdefghijklmnop"))
    if extension_id != VIMIUM_ID:
        raise ValueError("Expected the Chrome Web Store distribution of Vimium C.")

    injector = (vimium_dir / "lib/injector.js").read_text()
    # Preserve Vimium C's injector and wire protocol. Only relocate its scripts
    # into this package because MV3 forbids loading another extension's scripts.
    original = "t.src=e,k.insertBefore(t,g)"
    replacement = 't.src=chrome.runtime.getURL("vendor/vimium-c/"+e.split("/").slice(3).join("/")),k.insertBefore(t,g)'
    if injector.count(original) != 1:
        raise ValueError("The Vimium C injector format changed; review the integration before packaging.")

    for name in ("pdf.min.js", "pdf.worker.min.js"):
        if not (ROOT / "pdf/lib" / name).is_file():
            raise ValueError("Run ./setup.sh first to download PDF.js.")

    output.mkdir(parents=True, exist_ok=True)
    (output / "pdf/lib").mkdir(parents=True, exist_ok=True)
    vendor = output / "vendor/vimium-c"
    (vendor / "content").mkdir(parents=True, exist_ok=True)
    for name in ("viewer.js", "viewer.css"):
        shutil.copyfile(ROOT / "pdf" / name, output / "pdf" / name)
    for name in ("pdf.min.js", "pdf.worker.min.js"):
        shutil.copyfile(ROOT / "pdf/lib" / name, output / "pdf/lib" / name)
    shutil.copytree(ROOT / "icons", output / "icons", dirs_exist_ok=True)
    shutil.copyfile(ROOT / "LICENSE", output / "LICENSE")
    shutil.copyfile(ROOT / "chromium/manifest.json", output / "manifest.json")
    shutil.copyfile(ROOT / "chromium/init.js", output / "pdf/chromium-init.js")
    for name in ("vimium-c.js", "injected_end.js"):
        shutil.copyfile(vimium_dir / "content" / name, vendor / "content" / name)
    shutil.copyfile(vimium_dir / "LICENSE.txt", vendor / "LICENSE.txt")
    (vendor / "injector.js").write_text(injector.replace(original, replacement))
    (vendor / "NOTICE.txt").write_text(
        f"Vimium C {VIMIUM_VERSION}, https://github.com/gdh1995/vimium-c\n"
        "The injector is modified to load packaged foreground scripts.\n"
        "The foreground scripts are unmodified. See LICENSE.txt.\n"
    )
    (output / "vimium.json").write_text(json.dumps({"id": VIMIUM_ID, "version": VIMIUM_VERSION}) + "\n")
    html = (ROOT / "pdf/viewer-page.html").read_text()
    html = html.replace('<script src="viewer-page-init.js"></script>', "")
    html = html.replace('<script src="viewer.js"></script>', '<script type="module" src="chromium-init.js"></script>')
    (output / "pdf/viewer-page.html").write_text(html)
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vimium-dir", type=Path, required=True, help="Installed Vimium C 2.12.2 directory containing manifest.json")
    parser.add_argument("--output", type=Path, default=ROOT / "dist/chromium")
    args = parser.parse_args()
    print(package(args.vimium_dir.resolve(), args.output.resolve()))


if __name__ == "__main__":
    main()
