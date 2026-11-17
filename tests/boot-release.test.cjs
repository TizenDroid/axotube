"use strict";
// The native splash holds until the page has been quiet for 1.5 s after the app is ready,
// and never longer than 20 s.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/ui/bootLoader.js"), "utf8"));
const OVERLAY = "ytaf-boot-overlay";

function world() {
  let now = 0;
  const timers = [];
  const observers = [];
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
  const loader = { id: "loader" };
  const document = {
    readyState: "complete",
    documentElement: {},
    body,
    getElementById: (id) => (id === "loader" ? loader : null),
    createElement: () => ({ style: {} }),
    addEventListener() {},
  };
  class FakeObserver {
    constructor(cb) {
      this.cb = cb;
      this.live = true;
      observers.push(this);
    }
    observe() {}
    disconnect() {
      this.live = false;
    }
  }
  const win = { getComputedStyle: () => ({ backgroundColor: "rgb(9,9,9)" }) };
  const sandbox = {
    window: win,
    document,
    MutationObserver: FakeObserver,
    setTimeout: (fn, ms) => {
      const t = { fn, at: now + ms, done: false, cancelled: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (t) => {
      if (t) t.cancelled = true;
    },
  };
  new Function(
    "window",
    "document",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    SOURCE,
  )(sandbox.window, sandbox.document, sandbox.MutationObserver, sandbox.setTimeout, sandbox.clearTimeout);
  const shown = () => body.children.some((c) => c.id === OVERLAY);
  return {
    shown,
    runUntil(t) {
      for (;;) {
        const next = timers
          .filter((x) => !x.done && !x.cancelled && x.at <= t)
          .sort((a, b) => a.at - b.at)[0];
        if (!next) break;
        now = next.at;
        next.done = true;
        next.fn();
      }
      now = t;
    },
    mutate() {
      observers.filter((o) => o.live).forEach((o) => o.cb());
    },
    requestRelease: () => win.__releaseBootLoader(),
    now: () => now,
  };
}

test("the splash stays while the app is still starting, even past 10 s", () => {
  const w = world();
  assert.equal(w.shown(), true);
  w.runUntil(12000);
  assert.equal(w.shown(), true, "no longer released at 10 s");
});

test("once the app is ready, the splash goes after 1.5 s of quiet", () => {
  const w = world();
  w.runUntil(5000);
  w.requestRelease();
  w.runUntil(6400);
  assert.equal(w.shown(), true);
  w.runUntil(6600);
  assert.equal(w.shown(), false);
});

test("while the page keeps changing, the splash keeps waiting for quiet", () => {
  const w = world();
  w.runUntil(5000);
  w.requestRelease();
  w.runUntil(6000);
  w.mutate();
  w.runUntil(7000);
  assert.equal(w.shown(), true, "a change at 6 s pushes the release to 7.5 s");
  w.runUntil(7600);
  assert.equal(w.shown(), false);
});

test("the splash never waits past 20 s, even if the page never settles", () => {
  const w = world();
  w.runUntil(5000);
  w.requestRelease();
  for (let t = 5500; t < 20000; t += 500) {
    w.runUntil(t);
    w.mutate();
  }
  w.runUntil(20000);
  assert.equal(w.shown(), false);
});
