// The control features must not depend on the user agent or on the Tizen API
// being present. The service marks pages it serves; the page checks the marker.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("page feature gate no longer depends on isTizen or the user agent", () => {
  const src = read("mods/features/webConfig.js");
  assert.equal(src.includes("isTizen"), false, "isTizen should be fully replaced");
  assert.ok(src.includes("function serviceHost()"));
  assert.ok(src.includes("window.__axotubeServiceUrl"));
  assert.equal(/userAgent/.test(src), false, "webConfig must not read the UA");
});

// The marker must sit in the same injected tag string, directly before the
// early.js script tag, so it runs first. (The route handler also names early.js,
// so a plain indexOf comparison would look at the wrong occurrence.)
function assertMarkerBeforeEarly(src, label) {
  const marker = src.indexOf("window.__axotubeServiceUrl");
  assert.ok(marker > 0, `marker missing from ${label}`);
  const nearby = src.slice(marker, marker + 260);
  assert.ok(nearby.includes("/axotube/early.js"), `early.js tag must follow the marker in ${label}`);
}

test("node proxy marks served pages with the service URL before early.js", () => {
  assertMarkerBeforeEarly(read("service/proxy.js"), "proxy.js");
});

test("Java proxy marks served pages with the service URL before early.js", () => {
  assertMarkerBeforeEarly(read("android/app/src/main/java/org/axotube/tv/LocalProxy.java"), "LocalProxy.java");
});

test("Tizen-only helpers in service.js return quietly without tizen", () => {
  const src = read("service/service.js");
  assert.ok(src.includes("function hasTizen()"));
  for (const fn of ["tizenGetCapability", "tizenGetPackageId", "tizenLaunchAppControl", "buildYouTubeAppControl"]) {
    const start = src.indexOf(`function ${fn}(`);
    assert.ok(start >= 0, `${fn} missing`);
    const body = src.slice(start, start + 200);
    assert.ok(body.includes("hasTizen()"), `${fn} must check hasTizen()`);
  }
});
