"use strict";
// Auto subtitles: the track comes from the playing video's own list, set once the video is known,
// refreshed at playback start only when a track is set, and never turned on when captions are off.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/autoSubtitles.js"), "utf8"));

function load(config) {
  const watchers = [];
  const queue = [];
  const sandbox = { player: null };
  const mod = new Function(
    "configRead",
    "getCurrentPlayer",
    "watchVideoId",
    "setTimeout",
    "debugLog",
    SOURCE + "\nreturn { tryEnable };",
  )(
    (k) => config[k],
    () => sandbox.player,
    (fn) => watchers.push(fn),
    (fn) => queue.push(fn),
    () => {},
  );
  return {
    mod,
    sandbox,
    start: (videoId) => watchers.forEach((fn) => fn(videoId)),
    runQueued: () => {
      const next = queue.splice(0);
      next.forEach((fn) => fn());
      return next.length;
    },
  };
}

const EN = { languageCode: "en", kind: "", name: "English" };
const FR = { languageCode: "fr", kind: "", name: "French" };

// A player that reports which video it is on, and records every track it is given.
function player(videoId, tracklist, track = {}) {
  const state = { track, sets: [], listeners: {} };
  return {
    state,
    getOptions: () => ["captions"],
    loadModule() {},
    getVideoData: () => ({ video_id: videoId }),
    getOption: (m, o) => (o === "track" ? state.track : o === "tracklist" ? tracklist : null),
    setOption: (m, o, v) => {
      state.track = v;
      state.sets.push(v.name);
    },
    addEventListener: (type, fn) => (state.listeners[type] = fn),
    removeEventListener: (type) => delete state.listeners[type],
  };
}

test("nothing is set before the player reports this video (its caption list is the previous one's)", () => {
  const t = load({});
  const p = player("old", [EN]);
  assert.equal(t.mod.tryEnable(p, "new", "en", true, false), "retry");
  assert.deepEqual(p.state.sets, []);
});

test("the track is taken from this video's list, even when another video's track has the same language", () => {
  const t = load({});
  const p = player("new", [EN, FR], { languageCode: "en", kind: "", name: "English (old video)" });
  assert.equal(t.mod.tryEnable(p, "new", "en", true, false), "set");
  assert.deepEqual(p.state.sets, ["English"]);
});

test("a video starts with its track set once, and playback start refreshes it once if a track is set", () => {
  const t = load({ enableAutoSubtitles: true, autoSubtitleLanguage: "en", autoSubtitleAllowAuto: false });
  const p = player("v2", [EN]);
  t.sandbox.player = p;
  t.start("v2");
  assert.deepEqual(p.state.sets, ["English"], "set when the video is known");
  // Playback starts: the listener is registered; firing it refreshes the track.
  assert.equal(typeof p.state.listeners.onPlaybackStartExternal, "function");
  p.state.listeners.onPlaybackStartExternal();
  assert.deepEqual(p.state.sets, ["English", "English"], "refreshed at playback start");
  assert.equal(p.state.listeners.onPlaybackStartExternal, undefined, "the refresh is once per video");
});

test("captions the viewer turned off stay off: a refresh with an empty track sets nothing", () => {
  const t = load({ enableAutoSubtitles: true, autoSubtitleLanguage: "en", autoSubtitleAllowAuto: false });
  const p = player("v3", [EN]);
  t.sandbox.player = p;
  t.start("v3");
  assert.equal(p.state.sets.length, 1);
  p.state.track = {};
  p.state.listeners.onPlaybackStartExternal();
  assert.equal(p.state.sets.length, 1, "an empty track is respected");
});

test("a refresh for a video the player no longer reports does nothing", () => {
  const t = load({ enableAutoSubtitles: true, autoSubtitleLanguage: "en", autoSubtitleAllowAuto: false });
  const p = player("v4", [EN]);
  t.sandbox.player = p;
  t.start("v4");
  p.getVideoData = () => ({ video_id: "v5" });
  p.state.listeners.onPlaybackStartExternal();
  assert.equal(p.state.sets.length, 1, "the next video's track is not written for this one");
});
