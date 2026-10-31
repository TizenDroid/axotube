// The user agent profile selector: schema, phone page, and APK wiring.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validateConfigValue } = require("../shared/configPolicy.js");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const schema = JSON.parse(read("config-schema.json"));

test("schema defines userAgentProfile with auto as the default", () => {
  assert.equal(schema.defaults.userAgentProfile, "auto");
  assert.deepEqual(schema.enums.userAgentProfile, ["auto", "samsung", "android"]);
});

test("shared validation accepts only the three profiles", () => {
  for (const ok of ["auto", "samsung", "android"]) {
    assert.equal(validateConfigValue("userAgentProfile", ok), true, ok);
  }
  assert.equal(validateConfigValue("userAgentProfile", "chrome"), false);
  assert.equal(validateConfigValue("userAgentProfile", 1), false);
});

test("phone settings page lists the key in a category", () => {
  assert.ok(read("service/webConfigPage.js").includes('userAgentProfile:"System"'));
});

test("MainActivity resolves the profile and no longer hardcodes the TV agent", () => {
  const src = read("android/app/src/main/java/org/axotube/tv/MainActivity.java");
  assert.ok(src.includes("static String resolveUserAgent(String profile, String webViewDefault)"));
  assert.ok(src.includes('replace("; wv", "")'), "embedded-WebView marker must be removed");
  assert.equal(src.includes("setUserAgentString(TV_USER_AGENT)"), false);
  assert.ok(src.includes("WebSettings.getDefaultUserAgent(this)"));
});

test("ControlServer runs the save hook only when config changed", () => {
  const src = read("android/app/src/main/java/org/axotube/tv/ControlServer.java");
  assert.ok(src.includes("void setOnConfigSaved(Runnable callback)"));
  assert.ok(src.includes("if (result.changed && onConfigSaved != null) onConfigSaved.run();"));
});

test("MainActivity wires the save hook to the UI-thread apply", () => {
  const src = read("android/app/src/main/java/org/axotube/tv/MainActivity.java");
  assert.ok(src.includes("control.setOnConfigSaved(() -> applyUserAgentFromSave());"));
  assert.ok(src.includes("runOnUiThread("));
});
