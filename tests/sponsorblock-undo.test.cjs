// Back undoes the last SponsorBlock skip: one press, within a window, lands at
// the start of the skipped segment, which then plays and is not skipped again.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

class Events {
  constructor() { this.h = new Map(); }
  addEventListener(t, f) { if (!f) return; if (!this.h.has(t)) this.h.set(t, new Set()); this.h.get(t).add(f); }
  removeEventListener(t, f) { this.h.get(t)?.delete(f); }
  emit(t, p = {}) { for (const f of Array.from(this.h.get(t) || [])) f({ type: t, ...p }); }
}

function session(segments, { duration = 600, startAt = 0 } = {}) {
  let clock = 0, nextId = 0, ct = startAt, playing = true;
  const timers = new Map();
  const seeks = [];
  const reg = (fn, ms, every) => { const id = ++nextId; timers.set(id, { at: clock + Math.max(4, Number(ms) || 0), fn, every }); return id; };
  const clear = (id) => timers.delete(id);
  const runUntil = (until) => {
    for (let guard = 0; ; guard++) {
      if (guard > 50000) throw new Error("runaway timers");
      let sel = null;
      for (const [id, t] of timers) if (t.at <= until && (!sel || t.at < sel.t.at)) sel = { id, t };
      if (!sel) break;
      clock = sel.t.at;
      if (sel.t.every) sel.t.at += sel.t.every; else timers.delete(sel.id);
      sel.t.fn();
    }
    clock = until;
  };

  const video = new Events();
  Object.defineProperty(video, "currentTime", {
    get: () => ct,
    set: (v) => { seeks.push({ from: ct, to: v }); ct = v; setImmediate(() => video.emit("seeked")); },
  });
  video.duration = duration;
  Object.defineProperty(video, "paused", { get: () => !playing });
  video.playbackRate = 1;

  const window = new Events();
  window.location = { hash: "#/watch?v=vid1" };
  const document = new Events();
  document.readyState = "complete";
  document.querySelector = (s) => (s === "video" ? video : null);
  document.querySelectorAll = () => [];
  document.getElementById = () => null;
  document.createElement = () => ({ id: "", textContent: "" });
  document.head = { appendChild() {} };

  const cfg = { enableSponsorBlock: true, enableSponsorBlockSponsor: true, enableSponsorBlockToasts: true, sponsorBlockManualSkips: [] };
  const toasts = [];
  const ctx = vm.createContext({
    document, window, location: window.location,
    configChangeEmitter: new Events(),
    configRead: (k) => cfg[k],
    sha256: () => "abcd1234",
    t: (s, o) => s + (o ? JSON.stringify(o) : ""),
    showToast: (a, b) => toasts.push(b),
    setTimeout: (f, ms) => reg(f, ms, 0),
    clearTimeout: clear,
    setInterval: (f, ms) => reg(f, ms, Number(ms)),
    clearInterval: clear,
    console: { warn() {}, error() {}, log() {} },
    AbortController,
    Date: { now: () => clock + 1.7e12 },
    getJSON: () => ({ promise: Promise.resolve([{ videoID: "vid1", segments }]), abort() {} }),
    createBoundedCache: () => { const m = new Map(); return { get: (k) => m.get(k), has: (k) => m.has(k), delete: (k) => m.delete(k), set: (k, v) => { m.set(k, v); return v; }, clear: () => m.clear() }; },
  });
  const load = (f) => vm.runInContext(
    fs.readFileSync(path.join(ROOT, f), "utf8")
      .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/^export\s+\{[^}]+\};?\s*$/gm, ""),
    ctx, { filename: f });
  load("mods/shared/playerLifecycle.js");
  load("mods/features/sponsorblock.js");

    const flush = () => new Promise((r) => setImmediate(r));
  // Fixed number of 50 ms ticks, so media time advances exactly ms/1000 seconds.
  const step = async (ms) => {
    for (let i = 0; i < ms / 50; i++) {
      if (playing) ct += 0.05;
      if (ct >= duration) { ct = duration; playing = false; video.emit("pause"); }
      runUntil(clock + 50);
      video.emit("timeupdate");
      await flush();
    }
  };
  const back = async () => {
    const ev = { keyCode: 10009, stopped: false, preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; } };
    // Deliver the same object the test inspects (emit() would copy it).
    for (const f of Array.from(window.h.get("keydown") || [])) f(ev);
    await flush();
    return ev;
  };
  return { seeks, step, back, toasts, video, window, get handler() { return window.sponsorblock; }, get ct() { return ct; } };
}

const flush = () => new Promise((r) => setImmediate(r));

const sponsor = (s, e, id) => ({ category: "sponsor", UUID: id || `u${s}`, segment: [s, e], actionType: "skip" });

test("Back once after a skip returns to the start of the segment, which then plays through", async () => {
  const s = session([sponsor(60, 70)]);
  await s.step(62 * 1000);                  // skip at 60, landing 70, play on to ~72
  assert.equal(s.seeks.length, 1, "one skip so far");
  const ev = await s.back();
  assert.equal(ev.stopped, true, "Back is consumed");
  await s.step(15 * 1000);                  // play back through 60..70 and beyond
  assert.equal(s.seeks.length, 2, "exactly one undo seek, and no second skip");
  assert.equal(s.seeks[1].to, 60, "undo lands at the segment start");
  assert.ok(s.ct > 70, "the segment played through");
  assert.ok(s.toasts.some((x) => x.includes("sponsorblock.toasts.undone")), "undo toast shown");
});

test("a second Back does nothing: undo is one per skip", async () => {
  const s = session([sponsor(60, 70)]);
  await s.step(62 * 1000);
  await s.back();
  await s.step(1000);
  const ev = await s.back();
  assert.equal(ev.stopped, false, "second Back passes through to leanback");
});

test("Back after the window does nothing and passes through", async () => {
  const s = session([sponsor(60, 70)]);
  await s.step(62 * 1000);
  await s.step(15 * 1000);                  // now well past UNDO_WINDOW_S of media time
  const ev = await s.back();
  assert.equal(ev.stopped, false);
  assert.equal(s.seeks.length, 1, "no undo seek");
});

test("Back with no skip passes through", async () => {
  const s = session([sponsor(300, 310)]);
  await s.step(5 * 1000);
  const ev = await s.back();
  assert.equal(ev.stopped, false);
  assert.equal(s.seeks.length, 0);
});

test("a viewer seek ends the undo window", async () => {
  const s = session([sponsor(60, 70)]);
  await s.step(62 * 1000);
  s.video.currentTime = 200;                // the viewer seeks elsewhere
  await flush();
  const ev = await s.back();
  assert.equal(ev.stopped, false, "no undo after the viewer moved");
});
