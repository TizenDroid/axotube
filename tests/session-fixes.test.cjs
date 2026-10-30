// Behaviour tests for the subtitle, focus and motion changes.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");

function loadSubtitles(config) {
  const listeners = [];
  const timers = [];
  const ctx = vm.createContext({
    configRead: (k) => config[k],
    getCurrentPlayer: () => ctx.__player,
    watchVideoId: (fn) => listeners.push(fn),
    setTimeout: (fn) => timers.push(fn),
    console,
  });
  const src = read("mods/features/autoSubtitles.js").replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export\s+\{[^}]+\};?\s*$/gm, "");
  vm.runInContext(src, ctx, { filename: "autoSubtitles.js" });
  return { ctx, listeners, timers, api: vm.runInContext("({ chooseTrack, tryEnable })", ctx) };
}

const manualEn = { languageCode: "en", kind: "", name: "English" };
const autoEn = { languageCode: "en", kind: "asr", name: "English (auto-generated)" };
const manualHi = { languageCode: "hi", kind: "", name: "Hindi" };

test("subtitles: a manual track in the chosen language beats an auto-generated one", () => {
  const { api } = loadSubtitles({});
  assert.equal(api.chooseTrack([autoEn, manualEn], "en", true), manualEn);
});

test("subtitles: auto-generated is used only when allowed", () => {
  const { api } = loadSubtitles({});
  assert.equal(api.chooseTrack([autoEn], "en", true), autoEn);
  assert.equal(api.chooseTrack([autoEn], "en", false), null);
});

test("subtitles: a track in another language is never picked", () => {
  const { api } = loadSubtitles({});
  assert.equal(api.chooseTrack([manualHi], "en", true), null);
});

test("subtitles: turns the chosen track on when captions are off", () => {
  const { api, ctx } = loadSubtitles({});
  const set = [];
  ctx.__player = {
    getOptions: () => ["captions"],
    loadModule() {},
    getOption(mod, opt) {
      if (opt === "track") return {};
      if (opt === "tracklist") return [autoEn, manualEn];
      return null;
    },
    setOption(mod, opt, value) {
      set.push([mod, opt, value.name]);
    },
  };
  assert.equal(api.tryEnable(ctx.__player, "en", true), "done");
  assert.deepEqual(set, [["captions", "track", "English"]]);
});

test("subtitles: leaves captions alone when something is already on", () => {
  const { api, ctx } = loadSubtitles({});
  let touched = false;
  ctx.__player = {
    getOptions: () => ["captions"],
    getOption: (m, o) => (o === "track" ? { languageCode: "fr" } : []),
    setOption() {
      touched = true;
    },
  };
  assert.equal(api.tryEnable(ctx.__player, "en", true), "done");
  assert.equal(touched, false, "a choice already made (by YouTube or the user) is kept");
});

test("subtitles: asks for a retry until the caption list exists", () => {
  const { api } = loadSubtitles({});
  assert.equal(api.tryEnable(null, "en", true), "retry");
  assert.equal(
    api.tryEnable(
      { getOptions: () => [], getOption: () => null },
      "en",
      true,
    ),
    "retry",
    "no captions module yet",
  );
});

test("one-press: a focused element outside the player leaves the key to leanback", () => {
  const src = read("tests/one-press.test.cjs");
  assert.ok(src.includes("querySelectorAll"), "the harness supports the focus check");
  // The rule itself is pinned here; its behaviour is covered in one-press.test.cjs.
  assert.ok(read("mods/features/onePressMode.js").includes("focusIsOutsidePlayer() ||"));
});

test("motion: Reduced motion is applied after Fix UI, and Fix UI yields to it and to low memory", () => {
  const ui = read("mods/ui/ui.js");
  const fixUi = ui.indexOf('configRead("enableFixedUI") && !isLowMemory() && !isReducedMotion()');
  const lastReduced = ui.lastIndexOf("applyReducedMotionFlags();");
  assert.ok(fixUi !== -1, "Fix UI is gated on low memory and reduced motion");
  assert.ok(lastReduced > fixUi, "reduced motion runs after Fix UI, so it wins");
  assert.ok(!/isLimitedMemory/.test(ui.slice(fixUi, fixUi + 400)), "Fix UI no longer writes the memory flag");
});
