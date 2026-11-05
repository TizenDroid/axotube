// Entry point of the standalone core (standalone/service/dist/core.js). The loader
// (service/loader.js, shipped as dist/index.js) chooses which core runs.
// One bundle carries both the content proxy on 127.0.0.1:8081 and the control
// server on 8090 (pairing, config sync, phone commands, DIAL casting), so the
// standalone app and the Tizen module always run the same control code.
require("./node4-compat.js");
global.isAxoTubeStandalone = true;
require("./proxy.js");
require("./service.js");

// Keeps the core current through jsDelivr. Runs only when the loader started this
// core, which is what provides the cache folder; a bare run has no cache to update.
var nodeFetch = require("node-fetch");
var serviceUpdater = require("./serviceUpdater.cjs");

function fetchOk(url) {
  return nodeFetch(url, { timeout: 15000 }).then(function (res) {
    if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
    return res;
  });
}

var updater = serviceUpdater.createServiceUpdater({
  cacheDir: global.axotubeServiceCacheDir || null,
  shippedVersion: global.axotubeServiceShippedVersion,
  isRejected: function (version) {
    return typeof global.axotubeServiceIsRejected === "function" && global.axotubeServiceIsRejected(version);
  },
  fetchText: function (url) {
    return fetchOk(url).then(function (res) {
      return res.text();
    });
  },
  fetchBytes: function (url) {
    return fetchOk(url).then(function (res) {
      return res.buffer();
    });
  },
  notify: function (text) {
    if (typeof global.axotubeNotify === "function") global.axotubeNotify(text);
  },
  log: function (message) {
    console.log("[AxoTube:service-update] " + message);
  },
});
updater.start();
global.axotubeServiceUpdater = updater;
