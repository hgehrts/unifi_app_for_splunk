#!/usr/bin/env bash
# Build an installable Splunk package (tarball) of unifi_app_for_splunk.
#
# Usage:
#   ./build.sh [version]
#
# With no argument it reads the version from unifi_app_for_splunk/VERSION.
# Produces dist/unifi_app_for_splunk-<version>.tar.gz (+ .sha256).
#
# This packages the app directory as-is (unifi_app_for_splunk/). The ready-to-
# ship app is committed under unifi_app_for_splunk/.

set -euo pipefail

APP_DIR="unifi_app_for_splunk"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -d "$APP_DIR" ]]; then
  echo "ERROR: $APP_DIR/ not found in $ROOT" >&2
  exit 1
fi

VERSION="${1:-$(cat "$APP_DIR/VERSION")}"
OUT="dist/unifi_app_for_splunk-${VERSION}.tar.gz"
mkdir -p dist

# Strip cruft that must never ship.
find "$APP_DIR" \( -name '__pycache__' -o -name '*.pyc' -o -name '*.pyo' \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$APP_DIR" \( -name '._*' -o -name '.DS_Store' \) -delete 2>/dev/null || true
rm -rf "$APP_DIR/local" 2>/dev/null || true
command -v xattr >/dev/null 2>&1 && xattr -cr "$APP_DIR" 2>/dev/null || true

# Build a single-top-level-dir tarball without macOS metadata.
export COPYFILE_DISABLE=1
if tar --no-mac-metadata -czf /dev/null --files-from /dev/null 2>/dev/null; then
  tar --no-mac-metadata -czf "$OUT" "$APP_DIR"
else
  tar -czf "$OUT" "$APP_DIR"
fi

HASH=$(shasum -a 256 "$OUT" | awk '{print $1}')
printf '%s  %s\n' "$HASH" "$(basename "$OUT")" > "${OUT}.sha256"

echo "Built: $OUT"
echo "SHA-256: $(awk '{print $1}' "${OUT}.sha256")"
echo
echo "Top-level entries:"
tar -tzf "$OUT" | awk -F/ 'NF<=2 {print "  "$0}' | sort -u | head
