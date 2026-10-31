const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

// Loads the real module with its imports removed. The config listener at the
// bottom is stubbed out so the tests only see the decision functions.
function load(settings) {
  const source = fs
    .readFileSync(path.join(ROOT, "mods/shared/performanceMode.js"), "utf8")
    .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+/gm, "")
    .replace(/configChangeEmitter\.addEventListener[\s\S]*$/m, "");
  const ctx = vm.createContext({
    configRead: (key) => settings[key],
    configWrite: () => {},
    configChangeEmitter: { addEventListener() {} },
  });
  vm.runInContext(
    source +
      "\n;globalThis.m = { isPerformanceMode, isReducedMotion, isLowMemory, previewsEnabled, hqThumbnailMode };",
    ctx,
  );
  return ctx.m;
}

const base = { enableHqThumbnails: true, enablePreviews: true };

test("normal settings give eager thumbnails and previews", () => {
  const m = load({ ...base, enablePerformanceMode: false });
  assert.equal(m.hqThumbnailMode(), "eager");
  assert.equal(m.previewsEnabled(), true);
  assert.equal(m.isReducedMotion(), false);
});

test("performance mode switches on motion, memory, hover thumbnails and no previews", () => {
  const m = load({ ...base, enablePerformanceMode: true });
  assert.equal(m.isReducedMotion(), true);
  assert.equal(m.isLowMemory(), true);
  assert.equal(m.hqThumbnailMode(), "hover");
  assert.equal(m.previewsEnabled(), false);
});

test("older reduce motion and low memory switches still count", () => {
  const motion = load({ ...base, enableReducedMotion: true });
  const memory = load({ ...base, enableLowMemoryMode: true });
  assert.equal(motion.isReducedMotion(), true);
  assert.equal(motion.isLowMemory(), false);
  assert.equal(memory.isLowMemory(), true);
  assert.equal(memory.hqThumbnailMode(), "hover");
});

test("HQ thumbnails off stays off in every mode", () => {
  const m = load({ enableHqThumbnails: false, enablePerformanceMode: true });
  assert.equal(m.hqThumbnailMode(), "off");
});
