// The service sources that run on the TV's Node 4 runtime must be valid ES5 as
// written, not only after transpilation: loader.js runs before any build step, and
// the rest is checked here so a trailing comma or a let/const cannot slip in.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const acorn = require(path.join(ROOT, "mods", "node_modules", "acorn"));

const FILES = [
  "service/loader.js",
  "service/serviceUpdater.cjs",
  "service/bundleUpdates.cjs",
  "service/proxy.js",
  "service/standalone.js",
  "service/cdp/websocket.js",
  "service/cdp/sdb.js",
  "service/cdp/cdp.js",
  "service/cdp/launcher.js",
  "service/service.js",
  "service/diagnostics.js",
  "service/launchSettings.js",
  "service/webConfigPage.js",
  "service/diagnosticsPage.js",
  "shared/configPolicy.js",
];

for (const file of FILES) {
  test(file + " is valid ES5 as written", () => {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotThrow(() => acorn.parse(source, { ecmaVersion: 5 }));
  });
}
