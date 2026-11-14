// Drives the real mods/features/sponsorblock.js against a virtual clock and a
// simulated <video> that seeks asynchronously, the way a browser does.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = fs
  .readFileSync(path.join(ROOT, "mods/features/sponsorblock.js"), "utf8")
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");

class Events {
  constructor() {
    this.handlers = new Map();
  }
  addEventListener(type, fn) {
    if (!fn) return;
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    const set = this.handlers.get(type);
    if (set) set.delete(fn);
  }
  emit(type, payload = {}) {
    for (const fn of Array.from(this.handlers.get(type) || [])) fn({ type, ...payload });
  }
}

const DEFAULT_CONFIG = {
  enableSponsorBlock: true,
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockPreview: true,
  enableSponsorBlockFiller: true,
  enableSponsorBlockMusicOfftopic: true,
  enableSponsorBlockHighlight: true,
  enableSponsorBlockToasts: true,
  sponsorBlockManualSkips: [],
};

const seg = (category, start, end, extra = {}) => ({
  UUID: `${category}-${start}-${end}`,
  category,
  segment: [start, end],
  actionType: "skip",
  votes: 5,
  videoDuration: 600,
  ...extra,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

function makeWorld(opts = {}) {
  let clock = 0;
  let nextId = 1;
  const timers = new Map();
  const addTimer = (fn, delay, interval) => {
    const id = nextId++;
    timers.set(id, {
      fn,
      at: clock + Math.max(1, Number(delay) || 0),
      interval: interval || 0,
    });
    return id;
  };
  const runDue = () => {
    for (;;) {
      let best = null;
      for (const [id, timer] of timers) {
        if (timer.at <= clock && (!best || timer.at < best[1].at)) best = [id, timer];
      }
      if (!best) break;
      const [id, timer] = best;
      if (timer.interval) timer.at += timer.interval;
      else timers.delete(id);
      timer.fn();
    }
  };

  // The simulated <video>. A seek lands at once and reports `seeked` on the next
  // step, as a browser does. `snaps` makes the next seeks land elsewhere (keyframes).
  const video = new Events();
  let ct = opts.startAt || 0;
  let seeking = false;
  let seekDone = false;
  const seeks = [];
  const snaps = (opts.snaps || []).slice();
  Object.defineProperty(video, "currentTime", {
    get: () => ct,
    set: (target) => {
      seeks.push({ at: clock, to: target, from: ct });
      ct = snaps.length ? snaps.shift() : target;
      seeking = true;
      seekDone = true;
    },
  });
  Object.defineProperty(video, "seeking", { get: () => seeking });
  video.duration = opts.duration === undefined ? 600 : opts.duration;
  video.paused = false;
  video.playbackRate = opts.rate || 1;
  video.readyState = 4;
  let lastTimeupdate = 0;

  const win = new Events();
  win.location = { hash: opts.hash || "#/watch?v=vid1" };
  const doc = new Events();
  doc.readyState = "complete";
  const styleEl = { id: "", textContent: "" };
  doc.getElementById = (id) => (id === styleEl.id ? styleEl : null);
  doc.createElement = () => styleEl;
  doc.head = { appendChild() {} };
  doc.querySelector = (selector) => (selector === "video" ? video : null);
  doc.querySelectorAll = () => [];

  const config = { ...DEFAULT_CONFIG, ...(opts.config || {}) };
  const configEmitter = new Events();
  const toasts = [];
  const getJsonCalls = [];
  const aborted = [];
  const watchers = [];
  const defaultApi = () => Promise.resolve(opts.entries === undefined ? [] : opts.entries);
  const api = opts.api || defaultApi;

  const ctx = vm.createContext({
    document: doc,
    window: win,
    location: win.location,
    configChangeEmitter: configEmitter,
    configRead: (key) => config[key],
    showToast: (title, message) => toasts.push(message),
    t: (key, values) => (values ? `${key}:${values.segment || ""}` : key),
    getCurrentVideo: () => video,
    watchVideo: (fn) => watchers.push(fn),
    getJSON: (url) => {
      getJsonCalls.push(url);
      return {
        promise: api(url),
        abort() {
          aborted.push(url);
        },
      };
    },
    createBoundedCache: () => {
      const map = new Map();
      return {
        get: (k) => map.get(k),
        has: (k) => map.has(k),
        set: (k, v) => {
          map.set(k, v);
          return v;
        },
        delete: (k) => map.delete(k),
        clear: () => map.clear(),
      };
    },
    setTimeout: (fn, ms) => addTimer(fn, ms, 0),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => addTimer(fn, ms, Number(ms)),
    clearInterval: (id) => timers.delete(id),
    requestAnimationFrame: (fn) => addTimer(fn, 16, 0),
    cancelAnimationFrame: (id) => timers.delete(id),
    Date: { now: () => clock + 1700000000000 },
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
  });
  vm.runInContext(SOURCE, ctx, { filename: "mods/features/sponsorblock.js" });

  const step = () => {
    clock += 16;
    if (!video.paused && !seeking) ct += video.playbackRate * 0.016;
    if (seekDone) {
      seekDone = false;
      seeking = false;
      video.emit("seeked");
    }
    if (!video.paused && ct >= video.duration) {
      ct = video.duration;
      video.paused = true;
      video.emit("pause");
    }
    runDue();
    if (clock - lastTimeupdate >= 250) {
      lastTimeupdate = clock;
      if (!video.paused) video.emit("timeupdate");
    }
  };

  return {
    video,
    seeks,
    toasts,
    getJsonCalls,
    aborted,
    styleEl,
    win,
    config,
    get clock() {
      return clock;
    },
    get sponsorblock() {
      return win.sponsorblock;
    },
    step,
    setConfig(key, value) {
      config[key] = value;
      configEmitter.emit("configChange", { detail: { key, value } });
    },
    navigate(hash) {
      win.location.hash = hash;
      win.emit("hashchange");
    },
    backKey() {
      // Events.emit copies its payload, so the flag is kept in a closure.
      let prevented = false;
      const event = {
        keyCode: 10009,
        preventDefault() {
          prevented = true;
        },
        stopPropagation() {},
        stopImmediatePropagation() {},
      };
      win.emit("keydown", event);
      return prevented;
    },
    get watchersCount() {
      return watchers.length;
    },
  };
}

// Plays for `wallMs` of virtual time, running `actions` ({ at, run }) on the way.
async function play(world, wallMs, actions = []) {
  const start = world.clock;
  const pending = actions.map((a) => ({ ...a, done: false }));
  await flush();
  while (world.clock - start < wallMs) {
    for (const action of pending) {
      if (!action.done && world.clock - start >= action.at) {
        action.done = true;
        action.run(world);
      }
    }
    world.step();
    await flush();
  }
}

const skipToasts = (world) => world.toasts.filter((m) => m.startsWith("sponsorblock.toasts.skipping"));

test("a sponsor is skipped with one seek to its end and one toast", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(world, 40000);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [60],
  );
  assert.equal(skipToasts(world).length, 1);
});

test("adjacent segments are one jump, one seek, one toast", async () => {
  const world = makeWorld({
    entries: [seg("sponsor", 30, 40), seg("selfpromo", 40.1, 50)],
  });
  await play(world, 40000);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [50],
  );
  assert.equal(skipToasts(world).length, 1);
});

test("overlapping segments are one jump to the end of the longest", async () => {
  const world = makeWorld({
    entries: [seg("sponsor", 30, 60), seg("selfpromo", 35, 40)],
  });
  await play(world, 40000);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [60],
  );
});

test("an intro that starts with the video is skipped at once", async () => {
  const world = makeWorld({ entries: [seg("intro", 0, 5)] });
  await play(world, 10000);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [5],
  );
});

test("a segment at the very end lands before the end and is not skipped again", async () => {
  const world = makeWorld({ duration: 600, startAt: 580, entries: [seg("outro", 590, 600)] });
  await play(world, 30000);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [599.5],
  );
});

test("a keyframe snap-back is re-sought, then accepted, with no loop", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)], snaps: [55] });
  await play(world, 40000);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [60, 60],
  );
});

test("a manual (show) category is not skipped", async () => {
  const world = makeWorld({
    entries: [seg("sponsor", 30, 60)],
    config: { sponsorBlockManualSkips: ["sponsor"] },
  });
  await play(world, 40000);
  assert.deepEqual(world.seeks, []);
  assert.equal(skipToasts(world).length, 0);
});

test("an off category is neither skipped nor drawn on the bar", async () => {
  const off = makeWorld({
    entries: [seg("sponsor", 30, 60)],
    config: { enableSponsorBlockSponsor: false },
  });
  await play(off, 2000);
  await play(off, 40000);
  assert.deepEqual(off.seeks, []);
  assert.ok(!off.styleEl.textContent.includes("#00d400"));

  const on = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(on, 1500);
  assert.ok(on.styleEl.textContent.includes("#00d400"));
});

test("a viewer seek back before a skipped segment skips it again", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(world, 70000, [{ at: 41000, run: (w) => (w.video.currentTime = 10) }]);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [60, 10, 60],
  );
});

test("a viewer seek into a segment that was not skipped skips it", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(world, 5000, [{ at: 1000, run: (w) => (w.video.currentTime = 40) }]);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [40, 60],
  );
});

test("Back undoes the last skip: it returns to the segment, which plays through", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  let prevented = null;
  await play(world, 50000, [
    { at: 35000, run: (w) => (prevented = w.backKey()) },
  ]);
  assert.equal(prevented, true);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [60, 30],
  );
  assert.ok(world.toasts.some((m) => m.startsWith("sponsorblock.toasts.undone")));
});

test("a second Back after an undo passes through to leanback", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  const presses = [];
  await play(world, 40000, [
    { at: 35000, run: (w) => presses.push(w.backKey()) },
    { at: 36000, run: (w) => presses.push(w.backKey()) },
  ]);
  assert.deepEqual(presses, [true, false]);
});

test("turning a category off mid-video stops its skips", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(world, 40000, [
    { at: 5000, run: (w) => w.setConfig("enableSponsorBlockSponsor", false) },
  ]);
  assert.deepEqual(world.seeks, []);
});

test("a manual segment inside a skippable one stops the jump, and the rest is skipped after it", async () => {
  const world = makeWorld({
    entries: [seg("sponsor", 30, 60), seg("selfpromo", 45, 50)],
    config: { sponsorBlockManualSkips: ["selfpromo"] },
  });
  await play(world, 60000);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [45, 60],
  );
});

test("a manual segment right after a skip ends the jump at its start", async () => {
  const world = makeWorld({
    entries: [seg("sponsor", 30, 40), seg("selfpromo", 40.1, 50)],
    config: { sponsorBlockManualSkips: ["selfpromo"] },
  });
  await play(world, 30000);
  assert.deepEqual(
    world.seeks.map((s) => s.to),
    [40],
  );
});

test("a segment is fetched once per video, by its full ID, and reopening it reuses the answer", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(world, 2000);
  const first = world.getJsonCalls.filter((u) => u.includes("videoID=vid1"));
  assert.equal(first.length, 2, "one request to each server");
  assert.ok(first.every((u) => !u.includes("skipSegments/")), "no hash-prefix lookup");

  world.navigate("#/watch?v=vid2");
  await play(world, 500);
  world.navigate("#/watch?v=vid1");
  await play(world, 500);
  const again = world.getJsonCalls.filter((u) => u.includes("videoID=vid1"));
  assert.equal(again.length, 2, "reopening vid1 made no new request");
});

test("leaving a video while its request is in flight aborts it", async () => {
  const world = makeWorld({ api: () => new Promise(() => {}) });
  await play(world, 500);
  world.navigate("#/watch?v=vid2");
  await play(world, 500);
  const vid1 = world.getJsonCalls.filter((u) => u.includes("videoID=vid1"));
  assert.equal(world.aborted.filter((u) => u.includes("videoID=vid1")).length, vid1.length);
});

test("a segment at a different media length (an ad) is not skipped", async () => {
  const world = makeWorld({ duration: 15, entries: [seg("sponsor", 3, 12)] });
  await play(world, 8000);
  assert.deepEqual(world.seeks, []);
});

test("the bar is drawn again when the page removes its segment rules", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(world, 1500);
  assert.ok(world.styleEl.textContent.includes("#00d400"));
  world.styleEl.textContent = "";
  await play(world, 1500);
  assert.ok(world.styleEl.textContent.includes("#00d400"));
});

test("at 2x playback a sponsor is still skipped once, and not before its start", async () => {
  const world = makeWorld({ rate: 2, entries: [seg("sponsor", 30, 60)] });
  await play(world, 25000);
  assert.deepEqual(world.seeks.map((s) => s.to), [60]);
  assert.ok(world.seeks[0].from >= 29.8, `skipped from ${world.seeks[0].from}`);
});

test("at 0.75x playback the skip does not fire before the segment", async () => {
  const world = makeWorld({ rate: 0.75, entries: [seg("sponsor", 30, 60)] });
  await play(world, 60000);
  assert.deepEqual(world.seeks.map((s) => s.to), [60]);
  assert.ok(world.seeks[0].from >= 29.8, `skipped from ${world.seeks[0].from}`);
});

test("a stalled player does not skip early when playback resumes", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(world, 25000);
  world.video.paused = true;
  world.video.emit("pause");
  await play(world, 5000);
  world.video.paused = false;
  world.video.emit("play");
  await play(world, 15000);
  assert.deepEqual(world.seeks.map((s) => s.to), [60]);
  assert.ok(world.seeks[0].from >= 29.8);
});

test("leaving the watch page removes every media listener and never seeks again", async () => {
  const world = makeWorld({ entries: [seg("sponsor", 30, 60)] });
  await play(world, 5000);
  const before = Array.from(world.video.handlers.values()).reduce((n, set) => n + set.size, 0);
  assert.ok(before > 0, "listeners attached while on the video");
  world.navigate("#/browse");
  const after = Array.from(world.video.handlers.values()).reduce((n, set) => n + set.size, 0);
  assert.equal(after, 0, "all media listeners removed");
  await play(world, 40000);
  assert.deepEqual(world.seeks, []);
});

test("a skip and its toast are off when notices are disabled", async () => {
  const world = makeWorld({
    entries: [seg("sponsor", 30, 60)],
    config: { enableSponsorBlockToasts: false },
  });
  await play(world, 40000);
  assert.deepEqual(world.seeks.map((s) => s.to), [60]);
  assert.equal(world.toasts.length, 0);
});
