"use strict";
// The clock hides only for real playback on the watch page. A preview that plays in a
// browse tile must not hide it, and leaving the watch page must bring it back at once.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/clock.js"), "utf8"));

function makeWorld({ hash, config = {}, previewVideo, mainVideo }) {
  const body = {
    children: [],
    appendChild(n) {
      n.parentNode = this;
      this.children.push(n);
      return n;
    },
    removeChild(n) {
      this.children = this.children.filter((c) => c !== n);
      n.parentNode = null;
    },
  };
  const head = { appendChild() {} };
  const document = {
    body,
    head,
    documentElement: head,
    getElementById: (id) => body.children.find((c) => c.id === id) || null,
    createElement: () => ({ id: "", className: "", textContent: "", parentNode: null }),
    addEventListener() {},
  };
  const listeners = [];
  const win = {
    location: { hash },
    addEventListener(type, fn) {
      if (type === "hashchange") listeners.push(fn);
    },
  };
  const player = mainVideo ? { querySelector: () => mainVideo } : null;
  const cfg = { clockMode: "notPlaying", clockFormat: "24h", clockPosition: "topRight", clockShowSeconds: false, ...config };
  const mod = new Function(
    "configRead",
    "configChangeEmitter",
    "getCurrentPlayer",
    "getCurrentVideo",
    "formatClock",
    "document",
    "window",
    "setTimeout",
    "clearTimeout",
    SOURCE + "\nreturn { syncClock };",
  )(
    (key) => cfg[key],
    { addEventListener() {} },
    () => player,
    () => previewVideo || mainVideo || null,
    () => "12:00",
    document,
    win,
    () => 1,
    () => {},
  );
  const shown = () => body.children.some((c) => c.id === "axo-clock");
  return {
    mod,
    shown,
    setHash(h) {
      win.location.hash = h;
      listeners.forEach((fn) => fn());
    },
  };
}

const playing = { paused: false, ended: false };
const paused = { paused: true, ended: false };

test("a preview playing on a browse page does not hide the clock", () => {
  const w = makeWorld({ hash: "#/browse", previewVideo: playing });
  w.mod.syncClock();
  assert.equal(w.shown(), true);
});

test("the main video playing on the watch page hides the clock", () => {
  const w = makeWorld({ hash: "#/watch?v=abc", mainVideo: playing });
  w.mod.syncClock();
  assert.equal(w.shown(), false);
});

test("a paused video on the watch page shows the clock", () => {
  const w = makeWorld({ hash: "#/watch?v=abc", mainVideo: paused });
  w.mod.syncClock();
  assert.equal(w.shown(), true);
});

test("the player's own video is used, not the first <video> in the page (a preview)", () => {
  const w = makeWorld({ hash: "#/watch?v=abc", previewVideo: playing, mainVideo: paused });
  w.mod.syncClock();
  assert.equal(w.shown(), true, "the paused main video decides, not the playing preview");
});

test("leaving the watch page brings the clock back without waiting for a media event", () => {
  const w = makeWorld({ hash: "#/watch?v=abc", mainVideo: playing });
  w.mod.syncClock();
  assert.equal(w.shown(), false);
  w.setHash("#/browse");
  assert.equal(w.shown(), true);
});
