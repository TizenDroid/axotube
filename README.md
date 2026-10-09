# axotube

A TizenBrew module for YouTube TV on Samsung Tizen TVs. It filters supported ad placements and adds SponsorBlock, DeArrow, picture-in-picture, and playback controls.

## How to Install

1. Install [TizenBrew](https://github.com/reisxd/TizenBrew) on your TV.
2. Add `axotube` as an npm module in the TizenBrew module manager.

The npm package is published separately from the GitHub source. The version
available in TizenBrew may lag behind changes in this repository.

## Features

* Ad filtering for supported YouTube TV response formats
* [SponsorBlock](https://sponsor.ajay.app/) and [DeArrow](https://dearrow.ajay.app/)
* Picture-in-picture
* Custom themes, preferred video quality and codecs, and playback speed controls
* TV settings and paired phone configuration

## Building from source

Use Node.js 24 (the version used by CI):

```sh
npm ci --prefix mods
npm ci --prefix service
npm test
npm run build
```

The build writes the browser module and service to `dist/userScript.js` and
`dist/service.js`. Run `npm run build:standalone` to build the standalone
userscript and service bundles from current source.

The automated tests cover simulated YouTube and Tizen interfaces, not every
TV firmware. The standalone build does not by itself produce or install a
signed Tizen `.wgt` package. See [runtime architecture](docs/architecture.md)
for details.

## Credits

* **Aayu5h** - Main Developer & Maintainer
* **Ticklect** - Developer & Contributor
* **Reis Can (reisxd)** - Original Creator of TizenTube (upstream project)

## License

This project is licensed under the [GNU GPL v3](LICENSE).
