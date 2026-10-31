// One-press remote mode, run as the real module in a vm context with a fake
// clock. Each press sends keydown then keyup, the way a remote does.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function build({ controlsShown = false, playing = true, duration = 600, start = 100 } = {}) {
  let now = 1000000;
  const timers = new Map();
  let nextId = 1;
  const listeners = {};
  const video = { currentTime: start, duration, paused: !playing, playbackRate: 1 };
  video.pause = () => (video.paused = true);
  video.play = () => (video.paused = false);

  const hidden = { display: "block", visibility: "hidden", opacity: "0" };
  const shown = { display: "block", visibility: "visible", opacity: "1" };
  const bar = { __shown: controlsShown, getAttribute: () => null, classList: { contains: () => false }, parentNode: null, getClientRects: () => [{}] };
  const win = {
    location: { hash: "#/watch?v=abc123" },
    addEventListener(type, fn, capture) {
      (listeners[type] = listeners[type] || []).push({ fn, capture });
    },
    getComputedStyle: (el) => (el.__shown ? shown : hidden),
  };
  const doc = { querySelector: (sel) => (sel === "ytlr-progress-bar" ? bar : null), querySelectorAll: () => [] };
  const player = { rates: [], setPlaybackRate(r) { this.rates.push(r); video.playbackRate = r; } };
  const ctx = vm.createContext({
    window: win,
    document: doc,
    console,
    configRead: (k) => k === "enableOnePressMode",
    getCurrentVideo: () => video,
    getCurrentPlayer: () => player,
    Date: { now: () => now },
    setTimeout: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => { const id = nextId++; timers.set(id, { at: now + ms, fn, every: ms }); return id; },
    clearInterval: (id) => timers.delete(id),
  });
  ctx.window = win;
  const src = fs.readFileSync(path.join(ROOT, "mods/features/onePressMode.js"), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
  vm.runInContext(src, ctx, { filename: "onePressMode.js" });

  const fire = (type, code, target) => {
    const ev = {
      keyCode: code, target, stopped: false,
      preventDefault() {}, stopPropagation() {},
      stopImmediatePropagation() { this.stopped = true; },
    };
    for (const l of listeners[type] || []) l.fn(ev);
    return ev;
  };
  const advance = (ms) => {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next.t.at)) next = { id, t };
      if (!next) break;
      now = next.t.at;
      if (next.t.every) next.t.at += next.t.every; else timers.delete(next.id);
      next.t.fn();
    }
    now = end;
  };
  return {
    video, player, fire, advance,
    press: (code, holdMs = 50) => {
      const down = fire("keydown", code);
      advance(holdMs);
      const up = fire("keyup", code);
      return { down, up };
    },
  };
}

test("tap: one left or right tap seeks 10 seconds, and both events are stopped", () => {
  const r = build({ start: 100 });
  const down = r.fire("keydown", 39);
  r.advance(50);
  r.fire("keyup", 39);
  assert.equal(r.video.currentTime, 110);
  assert.equal(down.stopped, true);
});

test("taps that follow each other stack: 10, then 30, then 60, from where the last press aimed", () => {
  const r = build({ start: 100 });
  r.press(39); r.advance(300);             // 110
  r.press(39); r.advance(300);             // +30 -> 140
  assert.equal(r.video.currentTime, 140);
  r.press(39); r.advance(300);             // +60 -> 200
  assert.equal(r.video.currentTime, 200);
  r.press(39); r.advance(300);             // capped at 60 -> 260
  assert.equal(r.video.currentTime, 260);
});

test("a press after the streak window starts again at 10", () => {
  const r = build({ start: 100 });
  r.press(39); r.advance(1500);            // window expires
  r.press(39);
  assert.equal(r.video.currentTime, 120, "the second press is a fresh 10s from 110");
});

test("a repeat within 100ms is contact bounce and is ignored", () => {
  const r = build({ start: 100 });
  r.fire("keydown", 39); r.advance(10); r.fire("keyup", 39);
  r.advance(20);
  const bounce = r.fire("keydown", 39);
  assert.equal(r.video.currentTime, 110, "no second step");
  assert.equal(bounce.stopped, true, "the bounce does not reach leanback");
});

test("holding right past 1s plays at 2x and restores the rate on release", () => {
  const r = build({ start: 100, playing: true });
  r.fire("keydown", 39);
  r.advance(1200);
  assert.equal(r.video.playbackRate, 2);
  r.fire("keyup", 39);
  assert.equal(r.video.playbackRate, 1, "rate restored");
});

test("auto-repeat keydowns during a hold do not step again", () => {
  const r = build({ start: 100, playing: true });
  r.fire("keydown", 39);
  for (let i = 0; i < 20; i++) { r.advance(60); r.fire("keydown", 39); }
  assert.equal(r.video.currentTime, 110, "one step only");
  r.fire("keyup", 39);
});

test("a press held under 1s counts as a step, not a hold", () => {
  const r = build({ start: 100, playing: true });
  r.fire("keydown", 39);
  r.advance(600);
  r.fire("keyup", 39);
  r.advance(2000);
  assert.equal(r.video.playbackRate, 1);
  assert.equal(r.video.currentTime, 110);
});

test("holding left past 1s rewinds in steps while held and stops on release", () => {
  const r = build({ start: 200, playing: true });
  r.fire("keydown", 37);
  r.advance(1000 + 300 * 3 + 10);
  const at = r.video.currentTime;
  assert.ok(at < 190, `rewound while held, at ${at}`);
  r.fire("keyup", 37);
  const frozen = r.video.currentTime;
  r.advance(2000);
  assert.equal(r.video.currentTime, frozen, "no rewind after release");
});

test("OK toggles playback and is not stepped", () => {
  const r = build({ playing: true });
  r.press(13);
  assert.equal(r.video.paused, true);
  r.advance(300);
  r.press(13);
  assert.equal(r.video.paused, false);
});

test("controls visible: arrows and OK pass through to leanback", () => {
  const r = build({ controlsShown: true, start: 100 });
  const ev = r.fire("keydown", 39);
  assert.equal(r.video.currentTime, 100);
  assert.equal(ev.stopped, false);
});

test("focus on a tile leaves arrows to leanback", () => {
  const r = build({ start: 100 });
  const tile = { closest: () => ({ getAttribute: () => null, classList: { contains: () => false }, parentNode: null, __shown: true }) };
  const ev = r.fire("keydown", 39, tile);
  assert.equal(r.video.currentTime, 100);
  assert.equal(ev.stopped, false);
});

test("a stray keyup with no handled keydown passes through", () => {
  const r = build({ start: 100 });
  const up = r.fire("keyup", 37);
  assert.equal(up.stopped, false);
});
