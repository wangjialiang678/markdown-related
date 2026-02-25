#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

require_env() {
  local key="$1"
  if [[ -z "${!key:-}" ]]; then
    echo "Missing required env var: $key"
    exit 1
  fi
}

check_notarization_auth() {
  if [[ -n "${APPLE_API_KEY:-}" || -n "${APPLE_API_ISSUER:-}" ]]; then
    require_env APPLE_API_KEY
    require_env APPLE_API_ISSUER

    if [[ -z "${APPLE_API_KEY_PATH:-}" && -z "${APPLE_API_PRIVATE_KEYS_DIR:-}" ]]; then
      echo "Set APPLE_API_KEY_PATH or APPLE_API_PRIVATE_KEYS_DIR for notarytool auth"
      exit 1
    fi
    return 0
  fi

  if [[ -n "${APPLE_ID:-}" || -n "${APPLE_PASSWORD:-}" || -n "${APPLE_TEAM_ID:-}" ]]; then
    require_env APPLE_ID
    require_env APPLE_PASSWORD
    require_env APPLE_TEAM_ID
    return 0
  fi

  echo "No notarization credentials found."
  echo "Use either:"
  echo "  1) APPLE_API_KEY + APPLE_API_ISSUER + (APPLE_API_KEY_PATH or APPLE_API_PRIVATE_KEYS_DIR)"
  echo "  2) APPLE_ID + APPLE_PASSWORD + APPLE_TEAM_ID"
  exit 1
}

require_env APPLE_CERTIFICATE
require_env APPLE_CERTIFICATE_PASSWORD
check_notarization_auth

if [[ "$#" -gt 0 ]]; then
  TARGETS=("$@")
else
  TARGETS=("aarch64-apple-darwin" "x86_64-apple-darwin")
fi

for target in "${TARGETS[@]}"; do
  rustup target add "$target"
done

npm ci

for target in "${TARGETS[@]}"; do
  echo "Building notarized bundle for $target"
  npm run tauri build -- --target "$target" --bundles app,dmg

done

echo "Build complete. Check bundles under:"
echo "  $ROOT_DIR/src-tauri/target/*/bundle"
