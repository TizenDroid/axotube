"use strict";
// Runs the real content proxy (service/proxy.js) in its own process, with a stand-in
// for the Tizen runtime. Used by cdp-index.test.cjs. Settings come from the environment:
//   AXOTUBE_TEST_API_PORT    device API stand-in (developer settings)
//   AXOTUBE_TEST_SDB_PORT    SDB stand-in
//   AXOTUBE_TEST_YOUTUBE_URL where the CDP path navigates instead of YouTube
//   AXOTUBE_TEST_WGT_RUNNING "1" keeps the WGT listed as running (exit did not happen)
// Lines it prints that start with [TEST] describe the Tizen calls it received.
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const env = process.env;
const sdb = require(path.join(ROOT, "service", "cdp", "sdb.js"));
const launcher = require(path.join(ROOT, "service", "cdp", "launcher.js"));
const APP_ID = "axotubeapp.AxoTubeStandalone";

sdb.setEndpoints({
  apiPort: env.AXOTUBE_TEST_API_PORT ? Number(env.AXOTUBE_TEST_API_PORT) : undefined,
  sdbPort: env.AXOTUBE_TEST_SDB_PORT ? Number(env.AXOTUBE_TEST_SDB_PORT) : undefined,
});
if (env.AXOTUBE_TEST_YOUTUBE_URL) launcher.setTestOverrides({ youtubeUrl: env.AXOTUBE_TEST_YOUTUBE_URL });

global.tizen = {
  application: {
    getAppInfo: function () { return { packageId: "axotubeapp" }; },
    getAppsContext: function (cb) {
      cb(env.AXOTUBE_TEST_WGT_RUNNING === "1" ? [{ appId: APP_ID }] : []);
    },
    launch: function (id, ok) {
      process.stdout.write("[TEST] launch " + id + "\n");
      if (ok) ok();
    },
  },
  systeminfo: {
    getCapability: function () { return "5.5"; },
  },
};

require(path.join(ROOT, "service", "proxy.js"));
