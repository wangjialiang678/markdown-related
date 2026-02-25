#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEBUG_APP="$ROOT_DIR/src-tauri/target/debug/bundle/macos/Markdown Related.app"
RELEASE_APP="$ROOT_DIR/src-tauri/target/release/bundle/macos/Markdown Related.app"
APP_DST="/Applications/Markdown Related.app"

if [[ -d "$RELEASE_APP" ]]; then
  APP_SRC="$RELEASE_APP"
elif [[ -d "$DEBUG_APP" ]]; then
  APP_SRC="$DEBUG_APP"
else
  echo "No built app found. Run a build first: npm run tauri build -- --debug"
  exit 1
fi

echo "Installing from: $APP_SRC"
rm -rf "$APP_DST"
cp -R "$APP_SRC" "$APP_DST"

# Keep local debug app runnable even when attributes were carried over.
xattr -dr com.apple.quarantine "$APP_DST" 2>/dev/null || true

LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [[ -x "$LSREGISTER" ]]; then
  "$LSREGISTER" -f "$APP_DST"
fi

killall Finder >/dev/null 2>&1 || true

echo "Installed: $APP_DST"
echo "Tip: In Finder, pick a .md file -> Get Info -> Open with -> Markdown Related -> Change All"
