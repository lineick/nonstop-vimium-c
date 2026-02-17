#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure PDF.js is downloaded
if [ ! -f "pdf/lib/pdf.min.js" ] || [ ! -f "pdf/lib/pdf.worker.min.js" ]; then
  echo "PDF.js not found. Running setup.sh first..."
  ./setup.sh
fi

# Read version from manifest.json
VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
OUTPUT="nonstop-vimium-c-${VERSION}.xpi"

# Remove old build
rm -f "$OUTPUT"

# Package extension
echo "Building ${OUTPUT}..."
zip -r "$OUTPUT" \
  manifest.json \
  background.js \
  pdf/viewer.js \
  pdf/viewer.css \
  pdf/vimium-bridge.js \
  pdf/viewer-page.html \
  pdf/viewer-page-init.js \
  pdf/lib/pdf.min.js \
  pdf/lib/pdf.worker.min.js \
  options/options.html \
  options/options.js \
  options/options.css \
  icons/icon.png \
  LICENSE \
  -x "*.DS_Store" \
  > /dev/null

echo "Built: ${OUTPUT} ($(du -h "$OUTPUT" | cut -f1))"
echo ""
echo "To submit to AMO: https://addons.mozilla.org/en-US/developers/addon/submit/"
