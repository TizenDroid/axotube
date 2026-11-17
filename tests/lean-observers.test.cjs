"use strict";
// Work that runs on every page is limited to where it matters: the panel-shrink and error
// observers run on the watch page only, the clock repaints once a minute when seconds are
// hidden, now-playing posts on change, and verbose logs cost nothing unless switched on.
// Each test runs the shipped source with small DOM stubs.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// A MutationObserver stub that records what it watches and whether it was disconnected.
function observerStub(log) {
  return class FakeObserver {
    constructor(cb) {
      this.cb = cb;
      this.disconnected = false;
    }
    observe(target, opts) {
      this.target = target;
      this.opts = opts;
      log.push(this);
    }
    disconnect() {
      this.disconnected = true;
    }
  };
}

const live = (log, target) => log.filter((o) => !o.disconnected && o.target === target);

// ---- panel shrink -------------------------------------------------------------------------

function panelWorld({ hash, enabled }) {
  const observed = [];
  const Observer = observerStub(observed);
  const container = { id: "container", classList: { contains: () => false, toggle() {} } };
  const body = { classList: { contains: () => false, toggle() {} } };
  const document = {
    body,
    head: { appendChild() {} },
    documentElement: { style: { setProperty() {} } },
    getElementById: (id) => (id === "container" ? container : null),
    querySelector: () => null,
    createElement: () => ({ style: {}, id: "", textContent: "" }),
  };
  const listeners = {};
  const win = {
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
  };
  const loc = { hash };
  const frames = [];
  const cfg = { enablePanelShrink: enabled, panelShrinkPercent: 80 };
  new Function(
    "configRead",
    "configChangeEmitter",
    "document",
    "window",
    "location",
    "MutationObserver",
    "requestAnimationFrame",
    "setTimeout",
    blankSyntax(read("mods/features/panelShrink.js")),
  )(
    (k) => cfg[k],
    { addEventListener() {} },
    document,
    win,
    loc,
    Observer,
    (fn) => frames.push(fn),
    () => 0,
  );
  return {
    activeOnContainer: () => live(observed, container).length,
    hashchange(next) {
      loc.hash = next;
      listeners.hashchange.forEach((fn) => fn());
      // A browser runs queued animation frames before the next paint.
      while (frames.length) frames.shift()();
    },
  };
}

test("panel shrink watches the container only on the watch page, with the feature on", () => {
  assert.equal(panelWorld({ hash: "#/watch?v=a", enabled: false }).activeOnContainer(), 0, "feature off");
  assert.equal(panelWorld({ hash: "#/browse", enabled: true }).activeOnContainer(), 0, "browse page");
  assert.equal(panelWorld({ hash: "#/watch?v=a", enabled: true }).activeOnContainer(), 1, "watch, on");
});

test("panel shrink stops watching the container when the viewer leaves the watch page", () => {
  const w = panelWorld({ hash: "#/watch?v=a", enabled: true });
  assert.equal(w.activeOnContainer(), 1);
  w.hashchange("#/browse");
  assert.equal(w.activeOnContainer(), 0);
  w.hashchange("#/watch?v=b");
  assert.equal(w.activeOnContainer(), 1, "and starts again on the next watch page");
});

// ---- playback recovery --------------------------------------------------------------------

function recoveryWorld(hash) {
  const observed = [];
  const Observer = observerStub(observed);
  const body = {};
  const document = {
    body,
    addEventListener() {},
    querySelector: () => null,
  };
  const listeners = {};
  const win = {
    addEventListener(type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
    },
  };
  const loc = { hash, reload() {} };
  new Function(
    "t",
    "showToast",
    "document",
    "location",
    "window",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    blankSyntax(read("mods/features/playbackRecovery.js")),
  )(
    (key) => key,
    () => {},
    document,
    loc,
    win,
    Observer,
    () => 0,
    () => {},
  );
  return {
    activeOnBody: () => live(observed, body).length,
    hashchange(next) {
      loc.hash = next;
      listeners.hashchange.forEach((fn) => fn());
    },
  };
}

test("the whole-page error observer runs only on the watch page", () => {
  assert.equal(recoveryWorld("#/browse").activeOnBody(), 0, "browse");
  assert.equal(recoveryWorld("#/watch?v=a").activeOnBody(), 1, "watch");
});

test("the error observer is released on leaving the watch page and armed again on return", () => {
  const w = recoveryWorld("#/watch?v=a");
  w.hashchange("#/browse");
  assert.equal(w.activeOnBody(), 0);
  w.hashchange("#/watch?v=c");
  assert.equal(w.activeOnBody(), 1);
});

// ---- clock timing -------------------------------------------------------------------------

function clockWorld({ showSeconds }) {
  const delays = [];
  const body = {
    children: [],
    appendChild(n) {
      this.children.push(n);
      return n;
    },
    removeChild(n) {
      this.children = this.children.filter((c) => c !== n);
    },
  };
  const document = {
    body,
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById: (id) => body.children.find((c) => c.id === id) || null,
    createElement: () => ({ id: "", className: "", textContent: "" }),
    addEventListener() {},
  };
  const win = { location: { hash: "#/browse" }, addEventListener() {} };
  const cfg = { clockMode: "always", clockFormat: "24h", clockPosition: "topRight", clockShowSeconds: showSeconds };
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
    blankSyntax(read("mods/features/clock.js")) + "\nreturn { syncClock };",
  )(
    (k) => cfg[k],
    { addEventListener() {} },
    () => null,
    () => null,
    () => "12:00",
    document,
    win,
    (fn, ms) => {
      delays.push(ms);
      return delays.length;
    },
    () => {},
  );
  return { mod, delays };
}

test("with seconds shown, the clock repaints every second", () => {
  const w = clockWorld({ showSeconds: true });
  w.mod.syncClock();
  assert.equal(w.delays[w.delays.length - 1], 1000);
});

test("with seconds hidden, the clock waits for the next minute instead of repainting every second", () => {
  const w = clockWorld({ showSeconds: false });
  w.mod.syncClock();
  const delay = w.delays[w.delays.length - 1];
  assert.ok(delay > 1000 && delay <= 60050, String(delay));
});

// ---- verbose logs -------------------------------------------------------------------------

test("verbose logs are silent by default and cost nothing: no string is built", () => {
  const out = [];
  let builds = 0;
  const costly = () => {
    builds += 1;
    return "expensive";
  };
  const mod = new Function(
    "configRead",
    "window",
    "console",
    blankSyntax(read("mods/shared/debugLog.js")) + "\nreturn { debugLog };",
  )(
    (k) => (k === "enableDebugLogs" ? false : undefined),
    {},
    { log: (...a) => out.push(a) },
  );
  mod.debugLog("blocked", costly());
  assert.equal(out.length, 0, "nothing printed");
  assert.equal(builds, 1, "the argument is evaluated by the caller, which is the only cost");
});

test("verbose logs print with the setting on, and also for a console session flag", () => {
  const out = [];
  const make = (config, win) =>
    new Function(
      "configRead",
      "window",
      "console",
      blankSyntax(read("mods/shared/debugLog.js")) + "\nreturn { debugLog };",
    )((k) => (k === "enableDebugLogs" ? config : undefined), win, { log: (...a) => out.push(a) });
  make(true, {}).debugLog("on");
  assert.equal(out.length, 1);
  make(false, { __axotubeAdblockDebug: true }).debugLog("flag");
  assert.equal(out.length, 2);
  assert.equal(out[0][0], "[AxoTube]");
});

// ---- now playing --------------------------------------------------------------------------

function extractFunction(src, name) {
  const start = src.indexOf("function " + name + "(");
  assert.ok(start !== -1, name);
  let i = src.indexOf("{", start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error("unterminated " + name);
}

function nowPlayingWorld(hash) {
  const src = read("mods/features/webConfig.js");
  const decls = src
    .split("\n")
    .filter((l) => /^(let|const) (nowPlayingPushing|lastNowPlayingIdentity|lastNowPlayingPushAt|NOW_PLAYING_PROGRESS_INTERVAL_MS)\b/.test(l))
    .join("\n");
  assert.equal(decls.split("\n").length, 4, "all four state declarations present");
  const fns = extractFunction(src, "nowPlayingVideo") + "\n" + extractFunction(src, "pushNowPlaying");

  let now = 1000000;
  const posts = [];
  const main = { currentSrc: "main", paused: false, currentTime: 10, duration: 100 };
  const preview = { currentSrc: "preview", paused: false, currentTime: 3, duration: 50 };
  const player = { querySelector: (sel) => (sel === "video" ? main : null) };
  const document = {
    title: "Title",
    querySelector: (sel) => {
      if (sel === ".html5-video-player") return player;
      if (sel === "video") return preview;
      return null;
    },
  };
  const loc = { hash };
  const fetchWithTimeout = (url, opts) => {
    posts.push(JSON.parse(opts.body));
    return Promise.resolve({ ok: true });
  };
  const api = new Function(
    "location",
    "document",
    "Date",
    "serviceHost",
    "fetchWithTimeout",
    "nativeJSONStringify",
    "WEB_CONFIG_URL",
    decls + "\n" + fns + "\nreturn { pushNowPlaying };",
  )(loc, document, { now: () => now }, () => "http://service", fetchWithTimeout, JSON.stringify, "http://service");
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  return {
    push: async () => {
      api.pushNowPlaying();
      await settle();
    },
    posts,
    main,
    advance: (ms) => (now += ms),
    setHash: (h) => (loc.hash = h),
  };
}

test("now playing reads the watch page's own video, not a browse-tile preview", async () => {
  const w = nowPlayingWorld("#/watch?v=abc");
  await w.push();
  assert.equal(w.posts.length, 1);
  assert.equal(w.posts[0].progress, 10, "the main video, not the preview's 3 seconds");
  assert.equal(w.posts[0].state, "playing");
  assert.equal(w.posts[0].videoId, "abc");
});

test("now playing is not posted again for a tick of progress; it is posted on a change, and on a slow schedule", async () => {
  const w = nowPlayingWorld("#/watch?v=abc");
  await w.push();
  w.main.currentTime = 11;
  w.advance(1000);
  await w.push();
  assert.equal(w.posts.length, 1, "progress alone does not post");
  w.advance(31000);
  await w.push();
  assert.equal(w.posts.length, 2, "posted again after the progress interval");
  w.main.paused = true;
  await w.push();
  assert.equal(w.posts.length, 3, "a change of play state posts at once");
  assert.equal(w.posts[2].state, "paused");
});

test("leaving the watch page posts that nothing is playing, once", async () => {
  const w = nowPlayingWorld("#/watch?v=abc");
  await w.push();
  w.setHash("#/browse");
  await w.push();
  await w.push();
  assert.equal(w.posts.length, 2);
  assert.deepEqual(w.posts[1], {});
});
