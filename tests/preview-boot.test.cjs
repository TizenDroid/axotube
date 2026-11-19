"use strict";
// Autoplay on the first screen: only the tile that holds the initial focus waits while the
// splash is up. Its preview timer would otherwise run during the splash. Every other tile keeps
// its preview, and after the splash clears every tile does.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/videoPreviews.js"), "utf8"));

// A fresh module per scenario, so the initial-focus state starts clean.
function scenario(held) {
  const env = { held };
  const { addPreviews } = new Function(
    "configRead",
    "cloneJSON",
    "previewsEnabled",
    "isBootHeld",
    "location",
    SOURCE + "\nreturn { addPreviews };",
  )(
    (k) => ({ previewLengthSeconds: 5, previewSound: false })[k],
    (v) => JSON.parse(JSON.stringify(v)),
    () => true,
    () => env.held,
    { hash: "#/browse" },
  );
  return {
    env,
    batch: (n) => {
      const items = [];
      for (let i = 0; i < n; i++) items.push({ tileRenderer: { onSelectCommand: { watchEndpoint: { videoId: "v" + i } } } });
      addPreviews(items);
      return items.map((it) => !!it.tileRenderer.onFocusCommand);
    },
  };
}

test("during the splash, the initial-focus tile (the first) gets no preview; the others do", () => {
  const s = scenario(true);
  assert.deepEqual(s.batch(4), [false, true, true, true]);
});

test("after the splash clears, every tile gets its preview", () => {
  const s = scenario(true);
  s.batch(2);
  s.env.held = false;
  assert.deepEqual(s.batch(3), [true, true, true]);
});

test("with no splash at all, every tile gets its preview", () => {
  assert.deepEqual(scenario(false).batch(3), [true, true, true]);
});
