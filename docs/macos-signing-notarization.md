# macOS Signing + Notarization (Tauri)

## Version

This guide targets app version `0.3.1`.

## Required environment variables

Code signing:

- `APPLE_CERTIFICATE`: Base64-encoded `.p12` Developer ID Application certificate
- `APPLE_CERTIFICATE_PASSWORD`: Password of that `.p12`
- `APPLE_SIGNING_IDENTITY` (optional but recommended):
  - Example: `Developer ID Application: Your Name (TEAMID)`

Notarization authentication (choose one mode):

1) App Store Connect API key (recommended)

- `APPLE_API_KEY`: Key ID (e.g. `ABC123DEF4`)
- `APPLE_API_ISSUER`: Issuer UUID
- `APPLE_API_KEY_PATH` **or** `APPLE_API_PRIVATE_KEYS_DIR`

2) Apple ID credentials

- `APPLE_ID`
- `APPLE_PASSWORD` (app-specific password)
- `APPLE_TEAM_ID`

## Local notarized build

```bash
source "$HOME/.cargo/env"
cd "/Users/michael/projects/组件模块/markdown-related"

# export required APPLE_* vars first
npm run mac:release:notarized
```

Optional targets:

```bash
npm run mac:release:notarized -- aarch64-apple-darwin
npm run mac:release:notarized -- x86_64-apple-darwin
```

## CI workflow secrets

Set these GitHub repository secrets:

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY` (optional)
- `APPLE_API_KEY`
- `APPLE_API_ISSUER`
- `APPLE_API_KEY_P8_BASE64` (base64 content of `AuthKey_<KEYID>.p8`)

Then run workflow `.github/workflows/release-macos.yml` via `workflow_dispatch` or push a `v*` tag.
