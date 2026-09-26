#!/usr/bin/env bash

# Build the bundle and (unless asked otherwise) open the demo.
#
# The browser is no longer hardcoded: set BROWSER to override the command, or
# pass --build-only so a CI job can build without needing one installed.

set -euo pipefail

build_only=false
if [ "${1:-}" = "--build-only" ]; then
    build_only=true
fi

echo "building js from typescript ..."
npm run start
echo "... built"

if [ "$build_only" = true ]; then
    exit 0
fi

browser="${BROWSER:-google-chrome}"

if ! command -v "$browser" >/dev/null 2>&1; then
    echo "browser '$browser' not found; set BROWSER, or build only with --build-only" >&2
    exit 1
fi

"$browser" --allow-file-access-from-files dist/index.html
