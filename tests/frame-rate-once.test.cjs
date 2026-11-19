"use strict";
// Auto frame rate: a playback start that repeats for the same video and rate must not pause and
// set the display rate again (each repeat restarted the cycle, which is the pause loop).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/autoFrameRate.js"), "utf8"));

function world() {
  const listeners = {};
  const rates = [];
  let pauses = 0;
  let currentId = "v1";
  const video = {
    paused: false,
    pause() {
      this.paused = true;
      pauses += 1;
    },
    play() {
      this.paused = false;
      return { catch() {} };
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const player = {
    getStatsForNerds: () => ({ resolution: "1920x1080@24" }),
    addEventListener: (type, fn) => (listeners[type] = fn),
    removeEventListener() {},
  };
  let playerCb = null;
  let videoIdCb = null;
  new Function(
    "configRead",
    "configChangeEmitter",
    "nativeHost",
    "getCurrentPlayer",
    "getCurrentVideo",
    "getPlayerVideoId",
    "watchPlayer",
    "watchVideo",
    "watchVideoId",
    "window",
    "document",
    "setTimeout",
    "clearTimeout",
    "console",
    SOURCE,
  )(
    (k) => ({ autoFrameRate: true, autoFrameRatePauseVideoFor: 300 })[k],
    { addEventListener() {} },
    () => ({ SetFrameRate: function (r) { rates.push(r); } }),
    () => player,
    () => video,
    () => currentId,
    (cb) => (playerCb = cb),
    () => {},
    (cb) => (videoIdCb = cb),
    { location: { href: "https://x/#/watch?v=v1", hash: "#/watch?v=v1" }, addEventListener() {} },
    { addEventListener() {} },
    () => 1,
    () => {},
    console,
  );
  playerCb(player);
  return {
    start: () => listeners.onPlaybackStartExternal && listeners.onPlaybackStartExternal(),
    setVideo: (id) => {
      const old = currentId;
      currentId = id;
      video.paused = false; // a new video starts playing
      videoIdCb(id, old);
    },
    rates,
    pauses: () => pauses,
  };
}

test("repeated playback starts for one video set the rate and pause once", () => {
  const w = world();
  w.start();
  w.start();
  w.start();
  assert.deepEqual(w.rates, [24]);
  assert.equal(w.pauses(), 1);
});

test("a new video is handled once as well", () => {
  const w = world();
  w.start();
  w.setVideo("v2");
  w.start();
  w.start();
  assert.deepEqual(w.rates, [24, 24]);
  assert.equal(w.pauses(), 2);
});
