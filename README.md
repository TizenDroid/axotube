# AxoTube

<p align="center">
  <img src="standalone/icon.png" width="150" alt="AxoTube icon">
</p>

<p align="center">
  <a href="https://github.com/TizenDroid/axotube/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/TizenDroid/axotube?label=release"></a>
  <a href="https://github.com/TizenDroid/axotube/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/TizenDroid/axotube/ci.yml?label=CI"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-GPL--3.0--only-blue"></a>
</p>

<p align="center">
  YouTube TV for Samsung Tizen TVs, with ad filtering, SponsorBlock, DeArrow, and a settings menu that feels native.
</p>

AxoTube is a standalone Tizen web app for Samsung TVs. It wraps the YouTube TV
interface, filters responses before the page renders them, and adds the playback
and browsing controls the built-in app never gives you. It targets Tizen 4 and
later, including the 2018 models YouTube still treats as low-memory devices.

A TizenBrew module is included for people already running TizenBrew. The WGT,
installed with Apps2Samsung, is the recommended path and the one this README
covers first.

An experimental **Android TV APK** is also available alongside the Samsung WGT
in each new [versioned release](https://github.com/TizenDroid/axotube/releases).

> [!NOTE]
> AxoTube is a client for YouTube TV, not a replacement service. You still sign
> in with your own account, and YouTube still serves the video.

## What you get

### Watching

- **Ad filtering.** Removes ad slots, promo shelves, paid-promotion overlays, and
  end screen cards from the response data before YouTube TV draws them.
- **SponsorBlock.** Each category can skip automatically, show a skip button, or
  stay off. There is a highlight button for `poi_highlight` segments, and Back
  undoes a skip while the toast is still on screen.
- **DeArrow.** Community titles and thumbnails replace the clickbait versions.
  Long-press a tile to peek at the other title and thumbnail.
- **Quality and codecs.** Pick a preferred quality and codec, or unlock 1440p and
  2160p on a 1080p panel with the experimental resolution setting.
- **Playback controls.** Speed steps, frame-rate matching, automatic captions,
  picture-in-picture, a one-press remote mode, remaining time, and pause-on-blur.
- **Browsing.** High-quality thumbnails, inline previews with sound, watched-video
  hiding, a Shorts toggle, long-press queueing, sidebar cleanup, and a startup page.

### Around the app

- **A real settings menu.** Themes, text colours, screen dimming, an overlay clock,
  and panel shrink are all driven through YouTube's own modal renderer.
- **Performance mode.** One switch turns off animations, inline previews, and eager
  thumbnail upgrades for slower TVs.
- **Phone configuration.** Pair a phone with a six-digit code and change settings
  from the web page the TV serves on your network.
- **Updates without reinstalling.** The WGT can fetch newer page bundles through
  jsDelivr when the `axotube` npm package is published; the WGT only needs
  replacing when the service changes. The Android build uses the GitHub-backed
  jsDelivr channel instead.

## How it works

The WGT starts a small Node service on the TV. That service proxies YouTube TV
on port 8099, rewrites the URLs the page expects, and injects two scripts: an
early bundle before YouTube's own scripts, and the main bundle at the end. A
second listener on port 8085 handles DIAL casting and the phone configuration
page. The proxy talks to YouTube, and the optional features talk to the services
they need: SponsorBlock, DeArrow, and jsDelivr for bundle updates.

The browser bundle is built for Chromium 47, the engine inside Tizen 4. The test
suite parses the shipped output as ES5 for that reason.

## Install

### Apps2Samsung (recommended)

[Apps2Samsung](https://apps2samsung.com/) is a free, open-source installer for
Windows, macOS, Linux, Android, and iPhone (beta). It finds the TV, creates the
signing certificate, and installs the WGT. No Tizen Studio, no command line.

1. Download `axotube.wgt` from the [latest release](https://github.com/TizenDroid/axotube/releases/latest).
2. On the TV, open **Apps**, enter `12345`, and set **Host PC IP** to the address
   of the computer or phone running Apps2Samsung. Power-cycle the TV if it asks.
3. Install Apps2Samsung from [apps2samsung.com](https://apps2samsung.com/) or its
   [GitHub releases](https://github.com/Apps2Samsung/Apps2Samsung/releases). Keep
   it on the same network as the TV.
4. Open Apps2Samsung and let it scan. Select your TV from the list.
5. Choose **Custom WGT**, pick `axotube.wgt`, and install. The first install asks
   you to sign in to Samsung to create a signing certificate; later installs reuse
   it.
6. Launch **axotube** from the Apps screen.

### Tizen Studio

If you already have Tizen Studio and a signing profile, the CLI is quicker:

1. Download `axotube.wgt` from the [latest release](https://github.com/TizenDroid/axotube/releases/latest).
2. Put the TV in developer mode: open **Apps**, enter `12345`, and set the host
   PC address to the machine running Tizen Studio.
3. WGT files from automated releases are unsigned. Repackage the WGT with your
   Tizen Studio signing profile (or run `npm run package:wgt` from source), then
   install the signed WGT over the network:

   ```sh
   tizen install -n axotube.wgt -t <tv-name>
   ```

4. Launch **axotube** from the Apps screen.

The first launch starts the local service and opens YouTube TV. If the splash
stays on "Starting axotube service", give it a minute, then restart the app.

### TizenBrew

Add `axotube` as an npm module in the TizenBrew module manager. The npm package
can lag behind the GitHub source; the WGT is built from the same tree.

### Android TV (experimental)

Download `AxoTube-Android-<version>.apk` from [GitHub Releases](https://github.com/TizenDroid/axotube/releases)
and sideload it on your Android TV, for example with `adb install`. The
[TV installers workflow](https://github.com/TizenDroid/axotube/actions/workflows/android-apk.yml)
builds both the Android APK and Samsung `axotube.wgt` on every push to `main`,
on `vX.Y.Z` tags, and when run manually. Both files appear together in the
same prerelease for `main` builds or the same stable release for version tags.
Both are also available from workflow artifacts.

The automated WGT is **unsigned** and intended for Apps2Samsung, which signs
it for the selected TV during installation. Installing it directly with Tizen
Studio requires signing with a compatible certificate profile first.

The Android app starts a loopback proxy on port 8099 and checks for script updates
through jsDelivr's GitHub CDN. It pins both downloaded scripts to the same Git
commit and caches them locally; compiled scripts are included inside the APK for
offline startup. YouTube video playback still requires internet access.

Without Android signing secrets, CI publishes a debug-signed APK. The signing key
may differ between builds, so an upgrade can require uninstalling the older APK
and losing its local app data. The workflow supports stable release signing with
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, and
`ANDROID_KEY_PASSWORD` repository secrets. See [Android build instructions](android/README.md).

Android's WebView, device codecs, DRM and sign-in have not been verified on every
TV model. The Android APK does not yet provide the WGT's port 8085 DIAL casting
and phone configuration service.

## Settings

Open YouTube's settings and choose **AxoTube Settings**, or press the settings
key on the remote. The menu uses YouTube's own panels, so Back and focus behave
the way they do everywhere else. Everything is also available from the phone
page at `http://<tv-ip>:8085` after pairing.

## Build from source

You need Node.js 24. Packaging the WGT also needs Tizen Studio and a signing
profile named `axotube`.

```sh
npm install
npm test
npm run build              # dist/userScript.js, dist/early.js, dist/service.js
npm run build:standalone   # standalone/service/dist/index.js
npm run package:wgt        # runs tests, rebuilds, signs the WGT
python scripts/package-wgt-unsigned.py   # unsigned WGT for Apps2Samsung
```

`package:wgt` writes `standalone/release/axotube.wgt`. It runs the tests first
on purpose: a widget that installs but cannot boot is worse than a failed build.

## Project layout

| Path | What lives there |
| --- | --- |
| `mods/` | Browser bundle: response filters, player patches, settings UI |
| `service/` | Node service: content proxy, DIAL, pairing, config store |
| `standalone/` | WGT shell, splash page, service entry, signing metadata |
| `android/` | Experimental Android TV WebView app, local proxy, and bundle cache |
| `shared/configPolicy.js` | One validation policy used by the browser and the service |
| `tests/` | Regression suite, including ES5 output and runtime fixtures |

## Limitations

- The WGT targets Samsung Tizen TVs only. The experimental Android TV APK is a
  separate client; webOS and other platforms are not supported.
- SponsorBlock and DeArrow need their public APIs. If those are down, the
  features are simply absent for that session.
- Experimental 1440p and 2160p can stutter on a 1080p panel. The TV may accept
  the stream and still lack the decoder for it.
- The test suite uses simulated YouTube and Tizen interfaces. A firmware bug
  still needs a real TV to reproduce.

## Credits

- **Aayu5h** built and maintains AxoTube.
- **Ticklect** contributed fixes and features.
- **Reis Can (reisxd)** created TizenTube, the module AxoTube grew out of.

The design borrows ideas from [VacuumTube](https://github.com/shy1132/VacuumTube)
and [SmartTube](https://github.com/yuliskov/SmartTube), both worth a look if you
watch YouTube on a different box.

## License

GPL-3.0-only. See [LICENSE](LICENSE).
