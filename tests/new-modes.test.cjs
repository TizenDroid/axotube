// Runs the real experimentalResolution.js and onePressMode.js in a vm context
// with stubbed globals, and checks what they actually do.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function load(file, ctx) {
  const src = fs
    .readFileSync(path.join(ROOT, file), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
    .replace(/^export\s+\{[^}]+\};?\s*$/gm, "");
  vm.runInContext(src, ctx, { filename: file });
}

function makeWindow(extra = {}) {
  const listeners = {};
  return Object.assign(
    {
      addEventListener(type, fn, capture) {
        (listeners[type] = listeners[type] || []).push({ fn, capture });
      },
      location: { hash: "#/watch?v=abc123", reload() {} },
      matchMedia: () => ({ matches: false }),
      listeners,
    },
    extra,
  );
}

function keyEvent(keyCode) {
  const ev = {
    keyCode,
    prevented: false,
    stoppedImmediate: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {
      this.stoppedImmediate = true;
    },
  };
  return ev;
}

test("experimental: 2160p/1440p report a larger container and sane codec params pass", () => {
  const nativeCalls = [];
  const win = makeWindow();
  const MediaSource = {
    isTypeSupported(type) {
      nativeCalls.push(type);
      return true;
    },
  };
  const cfg = { enableExperimentalResolution: true, experimentalMaxResolution: "2160p" };
  win.MediaSource = MediaSource; // in a browser window.MediaSource is MediaSource
  const ctx = vm.createContext({
    window: win,
    MediaSource,
    console,
    location: win.location,
    configRead: (k) => cfg[k],
    configChangeEmitter: { addEventListener() {} },
  });
  ctx.window = win;
  load("mods/features/experimentalResolution.js", ctx);

  assert.equal(win.h5vcc.system.getVideoContainerSizeOverride(), "3840x2160");
  cfg.experimentalMaxResolution = "1440p";
  assert.equal(win.h5vcc.system.getVideoContainerSizeOverride(), "2560x1440");

  const ok = MediaSource.isTypeSupported(
    'video/webm; codecs="vp09.00.40.08"; width=2560; height=1440; framerate=60',
  );
  assert.equal(ok, true);
  // Sane params are stripped before the native check, which sees only codecs.
  assert.equal(nativeCalls.at(-1), 'video/webm; codecs="vp09.00.40.08"');
});

test("experimental: absurd params and HDR codecs on an SDR display are rejected", () => {
  const win = makeWindow();
  const MediaSource = { isTypeSupported: () => true };
  win.MediaSource = MediaSource;
  const cfg = { enableExperimentalResolution: true, experimentalMaxResolution: "1440p" };
  const ctx = vm.createContext({
    window: win,
    MediaSource,
    console,
    location: win.location,
    configRead: (k) => cfg[k],
    configChangeEmitter: { addEventListener() {} },
  });
  ctx.window = win;
  load("mods/features/experimentalResolution.js", ctx);

  assert.equal(MediaSource.isTypeSupported('video/webm; codecs="vp9"; framerate=9999'), false);
  assert.equal(
    MediaSource.isTypeSupported('video/webm; codecs="vp09.02.10.10.01.09.16.09.00"'),
    false,
  );
});

test("experimental: disabled leaves the platform untouched", () => {
  const win = makeWindow();
  const native = () => true;
  const MediaSource = { isTypeSupported: native };
  win.MediaSource = MediaSource;
  const cfg = { enableExperimentalResolution: false };
  const ctx = vm.createContext({
    window: win,
    MediaSource,
    console,
    location: win.location,
    configRead: (k) => cfg[k],
    configChangeEmitter: { addEventListener() {} },
  });
  ctx.window = win;
  load("mods/features/experimentalResolution.js", ctx);

  assert.equal(MediaSource.isTypeSupported, native);
  assert.equal(win.h5vcc, undefined);
});

function onePressContext({ hash = "#/watch?v=abc123", enabled = true, video }) {
  const win = makeWindow({ location: { hash, reload() {} } });
  const cfg = { enableOnePressMode: enabled };
  const ctx = vm.createContext({
    window: win,
    document: { querySelector: () => null },
    console,
    location: win.location,
    configRead: (k) => cfg[k],
    getCurrentVideo: () => video,
    getCurrentPlayer: () => null,
  });
  ctx.window = win;
  load("mods/features/onePressMode.js", ctx);
  const handler = win.listeners.keydown[0];
  assert.equal(handler.capture, true, "registered in the capture phase");
  return handler.fn;
}

test("one-press: left and right seek exactly 10 seconds and clamp to the media", () => {
  const video = { currentTime: 100, duration: 300, paused: false, pause() {}, play() {} };
  const fire = onePressContext({ video });
  const left = keyEvent(37);
  fire(left);
  assert.equal(video.currentTime, 90);
  assert.equal(left.stoppedImmediate, true, "leanback never sees the press");
  fire(keyEvent(39));
  assert.equal(video.currentTime, 100);

  video.currentTime = 4;
  fire(keyEvent(37));
  assert.equal(video.currentTime, 0, "clamped at the start");
  video.currentTime = 295;
  fire(keyEvent(39));
  assert.equal(video.currentTime, 300, "clamped at the end");
});

test("one-press: OK toggles playback", () => {
  let paused = false;
  const video = {
    currentTime: 0,
    duration: 300,
    get paused() {
      return paused;
    },
    pause() {
      paused = true;
    },
    play() {
      paused = false;
    },
  };
  const fire = onePressContext({ video });
  fire(keyEvent(13));
  assert.equal(paused, true);
  fire(keyEvent(13));
  assert.equal(paused, false);
});

test("one-press: inactive off the watch page, when disabled, and for other keys", () => {
  const video = { currentTime: 100, duration: 300, paused: false, pause() {}, play() {} };

  const offWatch = onePressContext({ hash: "#/browse", video });
  offWatch(keyEvent(39));
  assert.equal(video.currentTime, 100);

  const disabled = onePressContext({ enabled: false, video });
  disabled(keyEvent(39));
  assert.equal(video.currentTime, 100);

  const other = onePressContext({ video });
  const ev = keyEvent(40);
  other(ev);
  assert.equal(video.currentTime, 100);
  assert.equal(ev.stoppedImmediate, false);
});

function loadCodecPreference(preference) {
  const win = makeWindow();
  const calls = [];
  const MediaSource = {
    isTypeSupported(type) {
      calls.push(type);
      return true;
    },
  };
  win.MediaSource = MediaSource;
  const ctx = vm.createContext({
    window: win,
    MediaSource,
    console,
    location: win.location,
    configRead: (k) => (k === "videoPreferredCodec" ? preference : undefined),
    configChangeEmitter: { addEventListener() {} },
  });
  ctx.window = win;
  load("mods/features/codecPreference.js", ctx);
  return { check: (t) => MediaSource.isTypeSupported(t), calls };
}

test("codec preference: the chosen family passes and the others are refused", () => {
  const avc = loadCodecPreference("avc1");
  assert.equal(avc.check('video/mp4; codecs="avc1.640028"'), true);
  assert.equal(avc.check('video/webm; codecs="vp09.00.40.08"'), false);
  assert.equal(avc.check('video/mp4; codecs="av01.0.08M.08"'), false);
  // Audio-only types are not codecs of the video family and pass through.
  assert.equal(avc.check('audio/mp4; codecs="mp4a.40.2"'), true);

  const vp9 = loadCodecPreference("vp9");
  assert.equal(vp9.check('video/webm; codecs="vp09.00.40.08"'), true);
  assert.equal(vp9.check('video/mp4; codecs="avc1.640028"'), false);
});

test("codec preference: any changes nothing", () => {
  const any = loadCodecPreference("any");
  assert.equal(any.check('video/mp4; codecs="avc1.640028"'), true);
  assert.equal(any.check('video/webm; codecs="vp09.00.40.08"'), true);
});

test("user agent: the webview gets the Samsung TV string once", () => {
  const win = makeWindow({ navigator: { userAgent: "Mozilla/5.0 (Linux) Chrome/56" } });
  const applied = [];
  let reloads = 0;
  const session = new Map();
  win.tizen = { websetting: { setUserAgentString: (ua) => applied.push(ua) } };
  win.location.reload = () => reloads++;
  const ctx = vm.createContext({
    window: win,
    navigator: win.navigator,
    sessionStorage: {
      getItem: (k) => (session.has(k) ? session.get(k) : null),
      setItem: (k, v) => session.set(k, String(v)),
    },
    location: win.location,
    console,
  });
  ctx.window = win;
  load("mods/features/userAgentSpoofing.js", ctx);
  assert.deepEqual(applied, [
    "Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.3 (KHTML, like Gecko) SamsungBrowser/2.1 TV Safari/537.3",
  ]);
  assert.equal(reloads, 1, "one reload so the page picks the agent up");
});

test("user agent: no reload when the page already has the Samsung string", () => {
  const win = makeWindow({
    navigator: { userAgent: "Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) SamsungBrowser/2.1 TV Safari/537.3" },
  });
  let applied = 0;
  win.tizen = { websetting: { setUserAgentString: () => applied++ } };
  const ctx = vm.createContext({
    window: win,
    navigator: win.navigator,
    sessionStorage: { getItem: () => null, setItem() {} },
    location: win.location,
    console,
  });
  ctx.window = win;
  load("mods/features/userAgentSpoofing.js", ctx);
  assert.equal(applied, 0);
});

function onePressWithDom({ controlsShown = false, tile = false }) {
  const video = { currentTime: 100, duration: 300, paused: false, pause() {}, play() {} };
  const visibleEl = {
    getAttribute: () => null,
    classList: { contains: () => false },
    parentNode: null,
    getClientRects: () => [{}],
  };
  const hiddenStyle = { display: "block", visibility: "hidden", opacity: "0" };
  const shownStyle = { display: "block", visibility: "visible", opacity: "1" };
  const win = makeWindow({
    location: { hash: "#/watch?v=abc123", reload() {} },
    getComputedStyle: (el) => (el.__shown ? shownStyle : hiddenStyle),
  });
  const bar = Object.assign({}, visibleEl, { __shown: controlsShown });
  const tileNode = { getAttribute: () => null, classList: { contains: () => false }, parentNode: null, __shown: true };
  const tileEl = { closest: () => tileNode };
  const doc = {
    querySelector: (sel) => (sel === "ytlr-progress-bar" ? bar : null),
  };
  const ctx = vm.createContext({
    window: win,
    document: doc,
    console,
    location: win.location,
    configRead: (k) => k === "enableOnePressMode",
    getCurrentVideo: () => video,
    getCurrentPlayer: () => null,
  });
  ctx.window = win;
  load("mods/features/onePressMode.js", ctx);
  const down = win.listeners.keydown[0].fn;
  const up = win.listeners.keyup[0].fn;
  return { video, down, up, tileEl, doc };
}

test("one-press: visible controls leave arrows to leanback", () => {
  const { video, down } = onePressWithDom({ controlsShown: true });
  const ev = keyEvent(39);
  down(ev);
  assert.equal(video.currentTime, 100, "no seek while the progress bar is showing");
  assert.equal(ev.stoppedImmediate, false, "leanback gets the press");
});

test("one-press: a press we handle has its keyup swallowed, unhandled keyups pass", () => {
  const { down, up } = onePressWithDom({});
  const press = keyEvent(37);
  down(press);
  assert.equal(press.stoppedImmediate, true);
  const release = keyEvent(37);
  up(release);
  assert.equal(release.stoppedImmediate, true, "keyup of a handled press is swallowed");
  const stray = keyEvent(37);
  up(stray);
  assert.equal(stray.stoppedImmediate, false, "a later keyup with no handled keydown passes");
});

test("one-press: focus on a tile leaves arrows to leanback", () => {
  const { video, down, tileEl } = onePressWithDom({});
  const ev = keyEvent(39);
  ev.target = tileEl;
  down(ev);
  assert.equal(video.currentTime, 100);
  assert.equal(ev.stoppedImmediate, false);
});
