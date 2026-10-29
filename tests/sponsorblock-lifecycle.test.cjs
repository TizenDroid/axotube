// Drives the real mods/features/sponsorblock.js through video open/close
// sequences on a virtual clock. Covers the request lifecycle: nothing is
// requested for a video closed within a second, an in-flight request is aborted
// when the viewer leaves, results are reused, and the segment rules are removed
// on leave.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const STEP = 50;

class Events {
  constructor() {
    this.h = new Map();
  }
  addEventListener(t, f) {
    if (!f) return;
    if (!this.h.has(t)) this.h.set(t, new Set());
    this.h.get(t).add(f);
  }
  removeEventListener(t, f) {
    this.h.get(t)?.delete(f);
  }
  emit(t, p = {}) {
    for (const f of Array.from(this.h.get(t) || [])) f({ type: t, ...p });
  }
}

function session({
  hold = false,
  segments = [{ segment: [10, 20], category: "sponsor", UUID: "u1" }],
} = {}) {
  let clock = 0;
  let nextId = 0;
  const timers = new Map();
  const reg = (fn, delay, interval) => {
    const id = ++nextId;
    timers.set(id, { fn, at: clock + Math.max(4, Number(delay) || 0), interval });
    return id;
  };
  const runTimersUntil = (until) => {
    for (;;) {
      let sel = null;
      for (const [id, t] of timers) if (t.at <= until && (!sel || t.at < sel.t.at)) sel = { id, t };
      if (!sel) break;
      clock = sel.t.at;
      if (sel.t.interval) sel.t.at += sel.t.interval;
      else timers.delete(sel.id);
      sel.t.fn();
    }
    clock = until;
  };

  const video = new Events();
  video.duration = 600;
  video.paused = true;

  const window = new Events();
  const document = new Events();
  document.readyState = "complete";
  const styleEl = { id: "", textContent: "" };
  document.getElementById = (id) => (id === styleEl.id ? styleEl : null);
  document.createElement = () => styleEl;
  document.head = { appendChild() {} };
  document.querySelectorAll = () => [];
  document.querySelector = (s) => (s === "video" ? video : null);
  window.location = { hash: "#/watch?v=vid1" };

  const calls = [];
  const aborts = [];
  const errors = [];
  const cfg = {
    enableSponsorBlock: true,
    enableSponsorBlockSponsor: true,
    enableSponsorBlockIntro: false,
    enableSponsorBlockOutro: false,
    enableSponsorBlockInteraction: false,
    enableSponsorBlockSelfPromo: false,
    enableSponsorBlockPreview: false,
    enableSponsorBlockFiller: false,
    enableSponsorBlockMusicOfftopic: false,
    enableSponsorBlockToasts: false,
    sponsorBlockManualSkips: [],
  };

  const ctx = vm.createContext({
    document,
    window,
    location: window.location,
    configChangeEmitter: new Events(),
    configRead: (k) => cfg[k],
    sha256: () => "abcd1234",
    t: (s) => s,
    showToast() {},
    setTimeout: (f, ms) => reg(f, ms, 0),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (f, ms) => reg(f, ms, Number(ms)),
    clearInterval: (id) => timers.delete(id),
    console: { warn() {}, log() {}, error: (...a) => errors.push(a) },
    Date: { now: () => clock + 1.7e12 },
    getJSON: (url) => {
      calls.push(url);
      const promise = hold
        ? new Promise(() => {})
        : Promise.resolve([{ videoID: "vid1", segments }]);
      return {
        promise,
        abort() {
          aborts.push(url);
        },
      };
    },
    createBoundedCache: () => {
      const map = new Map();
      return {
        get: (k) => map.get(k),
        has: (k) => map.has(k),
        delete: (k) => map.delete(k),
        set: (k, v) => {
          map.set(k, v);
          return v;
        },
        clear: () => map.clear(),
      };
    },
  });

  const load = (f) =>
    vm.runInContext(
      fs
        .readFileSync(path.join(ROOT, f), "utf8")
        .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
        .replace(/^export\s+\{[^}]+\};?\s*$/gm, ""),
      ctx,
      { filename: f },
    );
  load("mods/shared/playerLifecycle.js");
  load("mods/features/sponsorblock.js");

  const flush = () => new Promise((resolve) => setImmediate(resolve));

  return {
    calls,
    aborts,
    errors,
    styleEl,
    window,
    async advance(ms) {
      for (let w = 0; w < ms; w += STEP) {
        runTimersUntil(clock + STEP);
        await flush();
      }
    },
    async go(hash) {
      window.location.hash = hash;
      window.emit("hashchange");
      await flush();
    },
  };
}

test("a video closed within a second never reaches the API", async () => {
  const s = session();
  await s.advance(500);
  await s.go("#/browse");
  await s.advance(3000);
  assert.equal(s.calls.length, 0, `unexpected requests: ${JSON.stringify(s.calls)}`);
});

test("leaving a video while its request is in flight aborts that request", async () => {
  const s = session({ hold: true });
  await s.advance(1500);
  assert.equal(s.calls.length, 1, "request sent after the delay");
  await s.go("#/browse");
  assert.equal(s.aborts.length, 1, "in-flight request aborted on leave");
  await s.advance(2000);
  assert.deepEqual(s.errors, [], "aborted request logs nothing");
});

test("reopening a video reuses its result instead of requesting again", async () => {
  const s = session();
  await s.advance(1500);
  await s.go("#/browse");
  await s.advance(200);
  await s.go("#/watch?v=vid1");
  await s.advance(2000);
  assert.equal(s.calls.length, 1, `requests: ${s.calls.length}`);
});

test("segment rules are drawn while on the video and removed on leave", async () => {
  const s = session();
  await s.advance(1500);
  assert.ok(s.styleEl.textContent.includes("linear-gradient"), "segments drawn");
  assert.ok(
    s.styleEl.textContent.includes('ytlr-progress-bar [idomkey="slider"]::after'),
    "drawn on the progress bar slider",
  );
  await s.go("#/browse");
  assert.equal(s.styleEl.textContent, "", "rules removed when the video is left");
});
