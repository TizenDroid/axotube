"use strict";
// The quality handler sets the player's quality. On a browse page the playing video is a
// preview, so it is capped. On the watch page the preferred quality applies, and a route change
// applies it again, so a preview cap never stays on a watch video.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/preferredVideoQuality.js"), "utf8"));

const QUALITIES = [
  { quality: "hd1080", qualityLabel: "1080p" },
  { quality: "hd720", qualityLabel: "720p" },
  { quality: "large", qualityLabel: "480p" },
  { quality: "medium", qualityLabel: "360p" },
];

function run({ hash, preferred, cap }) {
  const applied = [];
  const hashListeners = [];
  let stateListener = null;
  const location = { hash };
  const player = {
    getPlayerStateObject: () => ({ isPlaying: true }),
    getVideoData: () => ({ video_id: "vid" }),
    getVideoStats: () => ({}),
    getAvailableQualityData: () => QUALITIES,
    setPlaybackQualityRange: (a, b) => applied.push([a, b]),
    addEventListener: (type, fn) => {
      if (type === "onStateChange") stateListener = fn;
    },
    removeEventListener: () => {},
  };
  const cfg = { preferredVideoQuality: preferred, previewMaxQuality: cap };
  new Function(
    "configRead",
    "configChangeEmitter",
    "getCurrentPlayer",
    "watchPlayer",
    "watchVideoId",
    "location",
    "window",
    "setTimeout",
    "clearTimeout",
    "console",
    SOURCE,
  )(
    (k) => cfg[k],
    { addEventListener() {} },
    () => player,
    (cb) => cb(player),
    () => {},
    location,
    {
      addEventListener: (type, fn) => {
        if (type === "hashchange") hashListeners.push(fn);
      },
    },
    () => 0,
    () => {},
    console,
  );
  if (stateListener && applied.length === 0) stateListener();
  return {
    applied,
    changeRoute(next) {
      location.hash = next;
      hashListeners.forEach((fn) => fn());
    },
  };
}

test("a preview on a browse page is capped at the preview quality, not the global 1080p", () => {
  assert.deepEqual(run({ hash: "#/browse", preferred: "1080p", cap: "480p" }).applied, [["large", "large"]]);
});

test("a preview with the default auto quality is still capped (auto would remove the cap)", () => {
  assert.deepEqual(run({ hash: "#/browse", preferred: "auto", cap: "720p" }).applied, [["hd720", "hd720"]]);
});

test("a preference already below the cap is kept on a browse page", () => {
  assert.deepEqual(run({ hash: "#/browse", preferred: "360p", cap: "720p" }).applied, [["medium", "medium"]]);
});

test("the watch page is not capped: auto stays auto, a fixed preference applies as chosen", () => {
  assert.deepEqual(run({ hash: "#/watch?v=abc", preferred: "auto", cap: "480p" }).applied, [["auto", "auto"]]);
  assert.deepEqual(run({ hash: "#/watch?v=abc", preferred: "1080p", cap: "480p" }).applied, [["hd1080", "hd1080"]]);
});

test("the preview cap set to No limit leaves previews to the preference", () => {
  assert.deepEqual(run({ hash: "#/browse", preferred: "auto", cap: "off" }).applied, [["auto", "auto"]]);
});

test("a route change re-applies the quality: a preview cap does not stay on the watch video", () => {
  const r = run({ hash: "#/browse", preferred: "auto", cap: "480p" });
  assert.deepEqual(r.applied, [["large", "large"]], "the preview is capped");
  r.changeRoute("#/watch?v=abc");
  assert.deepEqual(r.applied[r.applied.length - 1], ["auto", "auto"], "the watch video gets the preferred quality");
});
