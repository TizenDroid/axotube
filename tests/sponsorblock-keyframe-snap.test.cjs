// Drives the real mods/features/sponsorblock.js against a virtual clock and a
// fake media element. Each scenario asserts where SponsorBlock seeks.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

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

async function scenario({
  segments,
  duration = 600,
  rate = 1,
  startAt = 0,
  wallSeconds = 90,
  actions = [],
  toasts = false,
  keyframeSnap = 0,
}) {
  let clock = 0,
    nextId = 0;
  const timers = new Map();
  const seeks = [];
  const toastLog = [];
  let performSkipCalls = 0;

  const reg = (fn, delay, interval) => {
    const id = ++nextId;
    timers.set(id, { fn, at: clock + Math.max(4, Number(delay) || 0), interval });
    return id;
  };
  const runTimersUntil = (until) => {
    let ops = 0;
    for (;;) {
      let sel = null;
      for (const [id, t] of timers) if (t.at <= until && (!sel || t.at < sel.t.at)) sel = { id, t };
      if (!sel) break;
      if (++ops > 20000) throw new Error("runaway timers");
      clock = sel.t.at;
      if (sel.t.interval) sel.t.at += sel.t.interval;
      else timers.delete(sel.id);
      sel.t.fn();
    }
    clock = until;
  };

  const video = new Events();
  let ct = startAt;
  // Parks the scenario between steps so promise callbacks (the API response)
  // run in the same order they would in the browser.
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  Object.defineProperty(video, "currentTime", {
    get: () => ct,
    set: (v) => {
      seeks.push({ wall: clock / 1000, from: ct, to: v });
      ct = keyframeSnap ? Math.floor(v / keyframeSnap) * keyframeSnap : v;
      // Browsers fire seeked asynchronously after the seek is applied.
      // Hard stop for the repro: an endless seek storm is the bug under test.
      if (seeks.length <= 50) setImmediate(() => video.emit("seeked"));
    },
  });
  video.duration = duration;
  video.paused = false;
  video.playbackRate = rate;
  video.stalled = false;

  const window = new Events();
  const document = new Events();
  document.readyState = "complete";
  document.querySelector = (s) => (s === "video" ? video : null);
  // Single <style> element, as the real DOM would hand back by id.
  const styleEl = { id: "", textContent: "" };
  document.getElementById = (id) => (id === styleEl.id ? styleEl : null);
  document.createElement = () => styleEl;
  document.head = { appendChild() {} };
  document.querySelectorAll = () => [];
  window.location = { hash: "#/watch?v=vid1" };
  const cfg = {
    enableSponsorBlock: true,
    enableSponsorBlockSponsor: true,
    enableSponsorBlockIntro: true,
    enableSponsorBlockOutro: true,
    enableSponsorBlockInteraction: true,
    enableSponsorBlockSelfPromo: true,
    enableSponsorBlockPreview: true,
    enableSponsorBlockFiller: true,
    enableSponsorBlockMusicOfftopic: true,
    enableSponsorBlockToasts: toasts,
    sponsorBlockManualSkips: [],
  };
  const ctx = vm.createContext({
    document,
    window,
    location: window.location,
    configChangeEmitter: new Events(),
    configRead: (k) => cfg[k],
    sha256: () => "abcd1234",
    t: (s, o) => s + (o ? JSON.stringify(o) : ""),
    showToast: (a, b) => toastLog.push(b),
    setTimeout: (f, ms) => reg(f, ms, 0),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (f, ms) => reg(f, ms, Number(ms)),
    clearInterval: (id) => timers.delete(id),
    requestAnimationFrame: (f) => reg(f, 16, 0),
    cancelAnimationFrame: (id) => timers.delete(id),
    console: { warn() {}, error() {}, log() {} },
    AbortController,
    Date: { now: () => clock + 1.7e12 },
    getJSON: () => ({ promise: Promise.resolve([{ videoID: "vid1", segments }]), abort() {} }),
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

  await new Promise((resolve) => setImmediate(resolve));
  const sb = ctx.window.sponsorblock;
  const origPerform = sb.performSkip.bind(sb);
  sb.performSkip = (...a) => {
    performSkipCalls++;
    return origPerform(...a);
  };

  const STEP = 50;
  let sinceTU = 0;
  for (let w = 0; w < wallSeconds * 1000; w += STEP) {
    for (const a of actions) if (a.at * 1000 === w) a.run({ video });
    if (!video.paused && !video.stalled) ct += video.playbackRate * (STEP / 1000);
    if (ct >= duration) {
      ct = duration;
      video.paused = true;
      video.emit("pause");
    }
    sinceTU += STEP;
    if (sinceTU >= 250) {
      sinceTU = 0;
      video.emit("timeupdate");
    }
    runTimersUntil(clock + STEP);
    await flush();
  }
  return { seeks, performSkipCalls, toastLog, finalCt: ct };
}

const sponsor = (s, e, id) => ({
  category: "sponsor",
  UUID: id || `u${s}`,
  segment: [s, e],
  actionType: "skip",
});

// Seeks that snap back to a keyframe grid (sparse-keyframe streams on the TV).
// The skip target lands before the segment end, so the landing looks like a
// viewer rewind and must not re-arm the same segment.
test("keyframe-snapped skip is bounded and playback gets past the segment", async () => {
  const r = await scenario({
    segments: [sponsor(60, 70)],
    rate: 1,
    wallSeconds: 90,
    keyframeSnap: 4,
  });
  assert.ok(r.seeks.length <= 3, `expected a bounded number of seeks, got ${r.seeks.length}`);
  assert.ok(r.finalCt >= 70, `playback must get past the segment, stopped at ${r.finalCt}`);
});
