#!/usr/bin/env bash
# Builds KesherIO-Connector-Service-<version>.zip: pinned Node 22 LTS node.exe + WinSW (both checksum-verified)
# + the UNCHANGED receiver bundle + install.ps1 / uninstall.ps1 / status.bat. Reads apps/connector/dist (run
# `node scripts/bundle.mjs` in apps/connector first); never modifies it. Output goes to $1 (default: a new temp dir).
# Run on macOS/Linux; nothing here needs Windows.
set -euo pipefail

NODE_VERSION=22.23.4
NODE_SHA256=dccc52de28d8df2ee22d2062424f8c563070d95d8ad70c54c4bf01d590dec14f   # win-x64/node.exe, from nodejs.org SHASUMS256.txt
WINSW_VERSION=2.12.0
WINSW_SHA256=05b82d46ad331cc16bdc00de5c6332c1ef818df8ceefcd49c726553209b3a0da   # WinSW-x64.exe (MIT); no upstream checksum is published, pinned at first fetch

HERE=$(cd "$(dirname "$0")" && pwd); DIST="$HERE/../dist"
OUT=${1:-$(mktemp -d)}; mkdir -p "$OUT"
fail() { echo "PACKAGE REFUSED: $1" >&2; exit 1; }
sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

[ -s "$DIST/vh30-receiver.cjs" ] || fail "missing $DIST/vh30-receiver.cjs (run 'node scripts/bundle.mjs' in apps/connector)"
DL=$(mktemp -d)   # downloads are untrusted until verified; nothing is run from here
trap 'rm -rf "$DL"' EXIT

curl -fsSL -o "$DL/node.exe" "https://nodejs.org/dist/v$NODE_VERSION/win-x64/node.exe"
[ "$(sha "$DL/node.exe")" = "$NODE_SHA256" ] || fail "node.exe checksum mismatch"
# second opinion straight from nodejs.org for the same version
curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" | grep -q "^$NODE_SHA256  win-x64/node.exe$" \
  || fail "nodejs.org SHASUMS256.txt does not list the pinned node.exe hash"
curl -fsSL -o "$DL/WinSW-x64.exe" "https://github.com/winsw/winsw/releases/download/v$WINSW_VERSION/WinSW-x64.exe"
[ "$(sha "$DL/WinSW-x64.exe")" = "$WINSW_SHA256" ] || fail "WinSW checksum mismatch"

PKG="$DL/KesherIO-Connector"; mkdir -p "$PKG/bin"
cp "$DL/node.exe" "$DL/WinSW-x64.exe" "$PKG/bin/"
cp "$DIST/vh30-receiver.cjs" "$PKG/bin/"
[ -f "$DIST/vh30-replay.cjs" ] && cp "$DIST/vh30-replay.cjs" "$PKG/bin/"
cp "$HERE/install.ps1" "$HERE/uninstall.ps1" "$HERE/status.bat" "$HERE/KesherIOConnector.xml.template" "$PKG/"
printf 'node %s\nwinsw %s\nreceiver sha256 %s\n' "$NODE_VERSION" "$WINSW_VERSION" "$(sha "$PKG/bin/vh30-receiver.cjs")" > "$PKG/VERSION.txt"

# nothing secret may ship
if grep -raEl 'kvc_[0-9a-f]{8}_[A-Za-z0-9_-]{43}|postgres(ql)?://[^ :/@]+:[^ @]+@|eyJ[A-Za-z0-9_-]{15,}\.|SERVICE_ROLE' "$PKG" --exclude=node.exe --exclude=WinSW-x64.exe >/dev/null; then
  fail "a token/password/JWT-shaped string is in the package"
fi
find "$PKG" \( -name 'connector.json' -o -name 'status.json' -o -name '*.hl7' -o -name '*.frame' \) | grep -q . && fail "a data/config file is in the package"

ZIP="$OUT/KesherIO-Connector-Service-node$NODE_VERSION-winsw$WINSW_VERSION.zip"
rm -f "$ZIP"; ( cd "$DL" && zip -q -r -X "$ZIP" KesherIO-Connector )
echo "$ZIP"; echo "sha256 $(sha "$ZIP")"; unzip -Z1 "$ZIP"
