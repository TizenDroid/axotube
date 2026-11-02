"use strict";
// The updater's update calls must reach the proxy wherever the page is served
// from. On the CDP path the page is youtube.com, so the launcher names the proxy
// through window.__axotubeProxyUrl. The function is read from the source and run
// against stub windows, so the real code is what is tested.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "mods", "features", "updater.js"), "utf8");
const fnSource = /function proxyUrl\(path\) \{[\s\S]*?\r?\n\}\r?\n/.exec(src);

function proxyUrlFor(win, p) {
  assert.ok(fnSource, "proxyUrl is defined in updater.js");
  const sandbox = { window: win };
  vm.createContext(sandbox);
  vm.runInContext(fnSource[0] + ";\nresult = proxyUrl(" + JSON.stringify(p) + ");", Object.assign(sandbox, { result: null }));
  return sandbox.result;
}

test("on the CDP path (youtube.com) the update calls go to the proxy, not the page origin", () => {
  const win = { location: { origin: "https://www.youtube.com" }, __axotubeProxyUrl: "http://127.0.0.1:8081" };
  assert.equal(proxyUrlFor(win, "/axotube/update/check"), "http://127.0.0.1:8081/axotube/update/check");
});

test("on the proxy path the page origin is used, as before", () => {
  const win = { location: { origin: "http://localhost:8081" } };
  assert.equal(proxyUrlFor(win, "/axotube/update/apply"), "http://localhost:8081/axotube/update/apply");
});

test("a page with no origin falls back to the default proxy address", () => {
  assert.equal(proxyUrlFor({ location: {} }, "/axotube/update/check"), "http://localhost:8081/axotube/update/check");
});
