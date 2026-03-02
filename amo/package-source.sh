#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_DIR"

VERSION=$(grep '"version"' manifest.json | head -1 | sed 's/.*: *"\(.*\)".*/\1/')
OUTPUT="amo/nonstop-vimium-c-${VERSION}-source.zip"

if [ -f "$OUTPUT" ]; then
  echo "ERROR: ${OUTPUT} already exists. Remove it first."
  exit 1
fi

echo "Packaging source: ${OUTPUT}..."
zip -r "$OUTPUT" . \
  -x ".git/*" \
  -x ".gitignore" \
  -x ".claude/*" \
  -x "amo/*" \
  -x "*.xpi" \
  -x "*.DS_Store" \
  > /dev/null

echo "Done: ${OUTPUT} ($(du -h "$OUTPUT" | cut -f1))"
