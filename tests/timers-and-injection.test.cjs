// Guards for the timer consolidation and the early-bundle injection.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("SponsorBlock uses no polling timers: wakeups are scheduled per segment", () => {
  const src = read("mods/features/sponsorblock.js");
  assert.ok(!src.includes("setInterval"), "no setInterval");
  assert.ok(src.includes("scheduleWake(now)"));
  assert.ok(src.includes("configGeneration"), "config is cached and invalidated by generation");
});

test("preferred quality has no player polling; watchPlayer drives attachment", () => {
  const src = read("mods/features/preferredVideoQuality.js");
  assert.ok(!src.includes("setInterval"));
  assert.ok(!src.includes("pollForPlayer"));
  assert.ok(src.includes("watchPlayer((player) => this.#attachPlayer(player))"));
});

test("early-bundle features install once and reload only when the change matters", () => {
  const res = read("mods/features/experimentalResolution.js");
  assert.ok(res.includes("__axotubeResolutionOwner"));
  assert.ok(res.includes('key === "experimentalMaxResolution" && configRead("enableExperimentalResolution")'));
  const codec = read("mods/features/codecPreference.js");
  assert.ok(codec.includes("__axotubeCodecOwner"));
});

test("standalone proxy injects the early bundle right after <head>, before the main bundle", () => {
  const src = read("standalone/service/index.js");
  assert.ok(src.includes("/<head(\\s[^>]*)?>/i"), "head regex is a real whitespace match");
  assert.ok(src.includes("'/axotube/early.js'"), "early bundle is served");
  const earlyAt = src.indexOf("var earlyTag");
  const mainAt = src.indexOf("text += '<script src=\"http://localhost:' + PORT + '/axotube/userScript.js\"></script>';");
  assert.ok(earlyAt !== -1 && mainAt !== -1 && earlyAt < mainAt, "early tag is built before the main tag");
});

test("rollup builds the main bundle and the early bundle, and the build copies early.js", () => {
  const rollup = read("mods/rollup.config.js");
  assert.ok(rollup.includes('input: "early.js"'));
  assert.ok(rollup.includes("../dist/early.js"));
  assert.ok(read("mods/early.js").includes("experimentalResolution.js"));
  assert.ok(read("scripts/build-standalone.js").includes("early.js"));
});
