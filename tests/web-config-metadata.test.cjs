"use strict";
// config-ui.json must describe every setting the schema accepts, and only those. A new
// setting added to config-schema.json without UI metadata fails here, so it cannot
// silently disappear from the Web Config. Also checks the pinned asset hashes.
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WEB = path.join(ROOT, "service", "web");
const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "config-schema.json"), "utf8"));
const ui = JSON.parse(fs.readFileSync(path.join(WEB, "config-ui.json"), "utf8"));
const pages = require(path.join(ROOT, "scripts", "build-web-pages.cjs"));

const CONTROLS = ["switch", "select", "range", "segmentMode", "themeColor", "url", "tags", "json", "derived", "hidden"];
const SEGMENT_TYPES = ["sponsor", "intro", "outro", "interaction", "selfpromo", "preview", "filler", "music_offtopic"];

test("every schema key has UI metadata, and no metadata names an unknown key", () => {
  const schemaKeys = Object.keys(schema.defaults).sort();
  const uiKeys = Object.keys(ui.settings).sort();
  assert.deepEqual(schemaKeys.filter((k) => !ui.settings[k]), [], "schema keys missing from config-ui.json");
  assert.deepEqual(uiKeys.filter((k) => !(k in schema.defaults)), [], "config-ui.json names keys the schema does not have");
});

test("every setting belongs to a declared section and has a label", () => {
  const sections = new Set(ui.sections.map((s) => s.id));
  for (const [key, s] of Object.entries(ui.settings)) {
    assert.ok(sections.has(s.section), key + " names an unknown section " + s.section);
    assert.ok(typeof s.label === "string" && s.label.length > 0, key + " has no label");
    assert.ok(CONTROLS.includes(s.control), key + " has an unknown control " + s.control);
    assert.ok(typeof s.order === "number", key + " has no order");
  }
});

test("hidden and derived settings are explained, not silently dropped", () => {
  for (const [key, s] of Object.entries(ui.settings)) {
    if (s.control === "hidden") assert.ok(s.hiddenReason, key + " is hidden without a reason");
    if (s.control === "derived") assert.ok(key === "sponsorBlockManualSkips", key + " is derived but not the documented SponsorBlock list");
  }
});

test("enum controls offer exactly the values the schema accepts", () => {
  for (const [key, values] of Object.entries(schema.enums)) {
    const s = ui.settings[key];
    assert.ok(s, key + " has no metadata");
    assert.equal(s.control, "select", key + " should be a select");
    assert.deepEqual(Object.keys(s.options).sort(), values.map(String).sort(), key + " options differ from the schema");
  }
});

test("theme presets match the schema's preset colours", () => {
  const s = ui.settings.themePreset;
  assert.deepEqual(Object.keys(s.options).sort(), Object.keys(schema.themePresetColors).sort());
});

test("range controls match the schema's bounds, with a real step", () => {
  for (const [key, bounds] of Object.entries(schema.ranges)) {
    const s = ui.settings[key];
    assert.ok(s, key + " has no metadata");
    if (s.control === "hidden") {
      assert.ok(s.hiddenReason, key + " is hidden, so it must say why");
      continue;
    }
    assert.equal(s.control, "range", key + " should be a range");
    assert.ok(typeof s.step === "number" && s.step > 0, key + " needs a positive step");
    assert.ok(bounds[0] <= bounds[1], key + " schema bounds are inverted");
  }
});

test("scaled ranges show units the stored value does not use directly", () => {
  // autoFrameRatePauseVideoFor is stored in milliseconds; the control shows seconds.
  assert.equal(ui.settings.autoFrameRatePauseVideoFor.scale, 0.001);
  // dimmingOpacity is stored 0 to 1; the control shows a percentage.
  assert.equal(ui.settings.dimmingOpacity.scale, 100);
  assert.equal(ui.settings.dimmingOpacity.unit, "%");
});

test("every dependency names a real setting", () => {
  for (const [key, s] of Object.entries(ui.settings)) {
    for (const dep of s.dependencies || []) {
      const depKey = typeof dep === "string" ? dep : dep.key;
      assert.ok(schema.defaults.hasOwnProperty(depKey), key + " depends on unknown key " + depKey);
    }
  }
});

test("the SponsorBlock segment controls cover every segment type the TV handles", () => {
  const types = Object.values(ui.settings)
    .filter((s) => s.control === "segmentMode")
    .map((s) => s.segmentType)
    .sort();
  assert.deepEqual(types, SEGMENT_TYPES.slice().sort());
});

test("the pinned assets in the shell match the files on disk", () => {
  const page = fs.readFileSync(path.join(ROOT, "service", "webConfigPage.js"), "utf8");
  for (const asset of pages.ASSETS) {
    const digest = crypto.createHash("sha384").update(fs.readFileSync(path.join(WEB, asset.file))).digest("base64");
    assert.ok(page.includes("sha384-" + digest), asset.file + " hash is stale; run node scripts/build-web-pages.cjs");
  }
});
