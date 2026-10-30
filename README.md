# AxoTube

YouTube TV for Samsung Tizen TVs (Tizen 4 and later). AxoTube runs as a web app
package (WGT) and adds ad filtering, SponsorBlock, DeArrow, picture-in-picture,
playback controls, and a settings panel that matches YouTube's own menus.

## Install

Package the app with `npm run package:wgt` (Windows, Tizen Studio installed),
then install the resulting `.wgt` on the TV in developer mode.

Page scripts update without reinstalling: the app checks the published bundle
and offers an update popup when a newer version exists.

## Build

```
npm install
npm run build            # page bundles (dist/userScript.js, dist/early.js)
npm run build:standalone # bundles for the WGT
npm test
```

To publish page-bundle updates: `node scripts/make-bundle-package.js`, then
`npm publish bundle-pkg --access public`.

## License

GPL-3.0-only. See `LICENSE`.
