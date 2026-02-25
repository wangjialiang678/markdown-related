# Markdown Related (Minimal Viewer)

Current version: `0.3.1`

This branch is a minimal Markdown viewer:

- No PDF export
- No edit mode
- No toolbar/sidebar controls
- Open `.md` file and render directly

## Run (development)

```bash
source "$HOME/.cargo/env"
npm install
npm run tauri:dev
```

## Build and install on macOS

```bash
source "$HOME/.cargo/env"
npm run mac:update
```

Installed app path:

- `/Applications/Markdown Related.app`

## Build APK (Android)

Initialize Android project (first run):

```bash
source "$HOME/.cargo/env"
npm run android:init
```

Build installable debug APK (arm64):

```bash
source "$HOME/.cargo/env"
npm run android:build:apk:debug
```

APK output:

- `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`

Build release APK (unsigned):

```bash
source "$HOME/.cargo/env"
npm run android:build:apk:release
```

APK output:

- `src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk`

## E2E regression (macOS)

Covers:

- open markdown on launch
- render content
- click markdown link and open another local markdown file
- screenshots + JSON report output

```bash
source "$HOME/.cargo/env"
npm run test:e2e:mac
```

Artifacts are written to:

- `artifacts/e2e-macos/<timestamp>/`

## Notes

- Finder file association remains enabled for `.md/.markdown/.mdown/.mkd`.
- WebDriver plugin is only enabled for debug builds with feature `webdriver`.
- Android Gradle repositories include Aliyun mirrors to avoid TLS handshake failures to `dl.google.com` in restricted networks.
