#!/bin/bash
set -euo pipefail

# Download PDF.js v3.11.174 (last v3.x with UMD/non-module builds)
PDFJS_VERSION="3.11.174"
BASE_URL="https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="${SCRIPT_DIR}/pdf/lib"

mkdir -p "$LIB_DIR"

echo "Downloading PDF.js v${PDFJS_VERSION}..."

# Core library (UMD build - works as regular <script> tag)
echo "  -> pdf.min.js"
curl -sL "${BASE_URL}/build/pdf.min.js" -o "${LIB_DIR}/pdf.min.js"

# Worker (UMD build)
echo "  -> pdf.worker.min.js"
curl -sL "${BASE_URL}/build/pdf.worker.min.js" -o "${LIB_DIR}/pdf.worker.min.js"

# Verify downloads
for f in pdf.min.js pdf.worker.min.js; do
  if [ ! -s "${LIB_DIR}/${f}" ]; then
    echo "ERROR: Failed to download ${f}"
    exit 1
  fi
done

echo ""
echo "PDF.js v${PDFJS_VERSION} downloaded successfully to pdf/lib/"
echo ""
echo "To install the extension in Firefox:"
echo "  1. Open about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on...'"
echo "  3. Select the manifest.json file"
