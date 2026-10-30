# AxoTube for Android TV

Native Android TV APK shell around the same YouTube TV page and generated AxoTube
mod scripts as the standalone Samsung WGT. Java source is in `app/src/main/java`.

## Build

Requirements: Android SDK platform 36, Java 17 or newer, Node.js and npm. This
project uses Android Gradle Plugin 9.2.0 and the checked-in Gradle 9.5.1 wrapper.

```sh
# From the repository root:
npm ci
npm run build
node android/copy-bundles.cjs
cd android
./gradlew assembleDebug
./gradlew assembleRelease
```

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`.
Unsigned release output is
`android/app/build/outputs/apk/release/app-release-unsigned.apk`; it cannot
be installed until signed. Supply environment variables
`ANDROID_KEYSTORE_FILE` (or `ANDROID_KEYSTORE_PATH`), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` to sign the release build.
For CI, `GITHUB_RUN_NUMBER` advances `versionCode` while `versionName` reads the
root package.json.

The Gradle build automatically runs `copyWebBundles` before packaging assets.
The file copy verifies both generated scripts and records the root package
version in `assets/bundles/version.json`. Run the root build first to avoid
shipping stale dist files. The copy is shared with the app's runtime fallback.

## Runtime

* The application binds port 8099 on **127.0.0.1 only** and opens
  `http://localhost:8099/tv` in a WebView with a TV user agent.
* `GET /axotube/health`, `GET /axotube/early.js`,
  `GET /axotube/userScript.js`, `GET /axotube/update`, and
  `POST /axotube/update/apply` mirror standalone service endpoints.
* The main YouTube TV HTML is proxied from `https://www.youtube.com`.
  `early.js` is injected at the start of `<head>`; `userScript.js` is
  appended at the end. Both URLs include the active bundle version, preventing
  a CDN change between the two script requests.
* The CORS bypass allows only explicit Google/YouTube asset hosts and
  `*.googlevideo.com` over HTTPS. The proxy forwards Range requests for media.
* On startup, Android checks jsDelivr for the current package.json and scripts.
  The working channel is the GitHub repository at
  `cdn.jsdelivr.net/gh/TizenDroid/axotube`. It resolves the current main
  commit through the GitHub API and pins the CDN download to that commit; if
  commit lookup is unavailable it tries the CDN's `@main` alias. The npm
  `axotube-bundle@latest` channel is a fallback if published later.
* An update is downloaded completely into a new private cache folder. After
  both files pass length/content verification, a small atomic active pointer
  switch activates the pair. If offline, malformed, or interrupted, the
  last complete cached bundle or the packaged scripts remain in use.
* The first check installs a newer bundle automatically if no cached version
  exists. Subsequent checks report updates and require applying through the
  existing UI; background checks repeat every six hours. The initial page waits
  at most four seconds for its first check.

## Current compatibility limits

The Android app does **not** run the WGT's separate port-8085 DIAL service.
As a result, YouTube TV remote-casting and pairing through the WGT's
`additionalDataUrl` are not available. The WebView opens `/tv` directly.
Hardware D-pad and media-key forwarding are implemented; actual video codec,
DRM, YouTube sign-in, and playback behavior depend on the Android TV device's
installed WebView and codecs. A successful APK build alone does not verify
these device-specific features.
The HTTP bridge supports GET, POST, PUT, DELETE and HEAD. Android's
HttpURLConnection rejects PATCH, so PATCH requests return HTTP 405.
