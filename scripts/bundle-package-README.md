# axotube

The page bundles for [AxoTube](https://github.com/TizenDroid/axotube), a YouTube
TV client for Samsung Tizen TVs and Android TV.

This package is not a library and has nothing to install. It exists so the
AxoTube apps can load their own JavaScript over a CDN instead of shipping an
update with every change.

## What is in it

| File | Loaded by | When |
|---|---|---|
| `dist/early.js` | the WGT and the APK | first, right after `<head>`, before YouTube reads its config |
| `dist/userScript.js` | the WGT and the APK | last, after the page is up |

Both bundles are built from the AxoTube source at the version in `package.json`,
so `axotube@latest` on jsDelivr always matches the release being shipped.

## Getting AxoTube

Download the WGT (Samsung) or the APK (Android TV) from the
[latest release](https://github.com/TizenDroid/axotube/releases/latest). The WGT
installs with [Apps2Samsung](https://github.com/PatrickKfkan/Apps2Samsung), which
signs it for your TV.

## License

GPL-3.0-only. See [LICENSE](https://github.com/TizenDroid/axotube/blob/main/LICENSE).
