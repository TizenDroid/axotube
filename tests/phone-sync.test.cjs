// Phone sync: the config page pairs from a QR link, and the settings panel shows
// the pairing code and address from a store that only accepts well-formed values.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const { webConfigPage } = require(path.join(ROOT, "service", "webConfigPage.js"));

test("the config application reads ?code= and pairs with it, without the startup load", () => {
  // The application is loaded from the release; its source is what matters here.
  const app = require("node:fs").readFileSync(path.join(ROOT, "service", "web", "config.js"), "utf8");
  assert.ok(app.includes("/[?&]code=(\\d{6})(?:&|$)/"), "regex has \\d");
  assert.ok(app.includes("function autoPairFromLink()"), "auto-pair function exists");
  assert.ok(app.includes("if (!autoPairFromLink()) load();"), "startup load is replaced, not raced");
  assert.ok(app.includes('history.replaceState(null, "", location.pathname)'), "code leaves the address bar");
});

test("the served shell pins its assets with integrity hashes", () => {
  assert.ok(webConfigPage.includes('integrity="sha384-'), "stylesheet and script carry SRI");
  assert.ok(webConfigPage.includes('crossorigin="anonymous"'), "SRI requires CORS");
  assert.ok(!webConfigPage.includes("__SRI_") && !webConfigPage.includes("__ASSET_BASE__"), "no placeholders left");
});

test("every script the config page serves parses as JavaScript", () => {
  const scripts = [...webConfigPage.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length >= 1);
  for (const source of scripts) {
    assert.doesNotThrow(() => new Function(source));
  }
});

test("the pairing store keeps only a six-digit code and plain http(s) addresses", async () => {
  const url = pathToFileURL(path.join(ROOT, "mods", "shared", "pairingInfo.js")).href;
  const store = await import(url);
  assert.equal(store.getPairingInfo(), null);
  assert.equal(store.pairingInfoAge(), Infinity);

  store.setPairingInfo({
    code: "123456",
    urls: ["http://192.168.1.5:8080", "javascript:alert(1)", "http://a/b", "https://tv.local:8080"],
  });
  assert.deepEqual(store.getPairingInfo(), {
    code: "123456",
    urls: ["http://192.168.1.5:8080", "https://tv.local:8080"],
  });
  assert.ok(store.pairingInfoAge() < 5000);

  for (const bad of [null, {}, { code: "12ab56" }, { code: 123456 }, { code: "1234567" }]) {
    store.setPairingInfo(bad);
    assert.equal(store.getPairingInfo(), null, "rejects " + JSON.stringify(bad));
  }
});

test("the settings tree opens with a phone-sync panel that reads the live store", () => {
  const fs = require("node:fs");
  const settings = fs.readFileSync(path.join(ROOT, "mods", "ui", "settings.js"), "utf8");
  assert.ok(settings.includes("livePanel(") && settings.includes("phoneSyncLines"));
  assert.ok(settings.includes("typeof node.options.content === \"function\""), "info panels accept live content");
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, "mods", "translations", "resources", "en.json"), "utf8"));
  for (const key of ["title", "subtitle", "intro", "address", "code", "waiting"]) {
    assert.ok(en.settings.phoneSync[key], "en has settings.phoneSync." + key);
  }
});
