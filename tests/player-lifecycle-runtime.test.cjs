const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

class Events {
  constructor() { this.handlers = new Map(); }
  addEventListener(type, fn) {
    if (!fn) return;
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.handlers.get(type)?.delete(fn); }
  emit(type, props = {}) {
    for (const fn of Array.from(this.handlers.get(type) || [])) fn({ type, ...props });
  }
  count(type) { return this.handlers.get(type)?.size || 0; }
}

function runtime() {
  let clock = 0;
  let nextTimer = 0;
  const timers = new Map();
  const calls = [];
  let player = null;
  let video = null;
  const config = {
    videoSpeed: 1.5, preferredVideoQuality: '1080p', autoFrameRate: true,
    autoFrameRatePauseVideoFor: 100, enableSponsorBlock: true,
  };
  const window = new Events();
  const document = new Events();
  const configChangeEmitter = new Events();
  window.location = {
    hash: '#/watch?v=one',
    get href() { return 'https://youtube.com/tv' + this.hash; },
  };
  document.readyState = 'complete';
  document.querySelector = (selector) => {
    if (selector === '.html5-video-player') return player;
    if (selector === 'video') return video;
    return null;
  };
  window.h5vcc = { tizentube: { SetFrameRate(value) { calls.push(value); } } };
  function register(fn, delay, interval) {
    const id = ++nextTimer;
    timers.set(id, { fn, at: clock + Math.max(0, Number(delay) || 0), interval });
    return id;
  }
  function advance(ms) {
    const until = clock + ms;
    let operations = 0;
    while (true) {
      let selected = null;
      for (const [id, timer] of timers) {
        if (timer.at <= until && (!selected || timer.at < selected.timer.at)) {
          selected = { id, timer };
        }
      }
      if (!selected) break;
      assert.ok(++operations < 1500, 'runaway timer detected');
      clock = selected.timer.at;
      if (selected.timer.interval) selected.timer.at += selected.timer.interval;
      else timers.delete(selected.id);
      selected.timer.fn();
    }
    clock = until;
  }
  const context = vm.createContext({
    document, window, location: window.location, configChangeEmitter,
    configRead: (key) => config[key],
    setTimeout: (fn, ms) => register(fn, ms, 0),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => register(fn, ms, Number(ms)),
    clearInterval: (id) => timers.delete(id),
    console: { warn() {}, error() {}, log() {} },
    AbortController,
    requestAnimationFrame: (fn) => register(fn, 16, 0),
    cancelAnimationFrame: (id) => timers.delete(id),
    fetch: () => Promise.reject(new Error('Unexpected fetch')),
  });

  function load(filename) {
    const code = fs.readFileSync(path.join(ROOT, filename), 'utf8')
      .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, '')
      .replace(/^export\s+\{[^}]+\};?\s*$/gm, '');
    vm.runInContext(code, context, { filename });
  }
  function loadLifecycle() {
    load('mods/shared/playerLifecycle.js');
    vm.runInContext('globalThis.lifecycle = { watchPlayer, watchVideo, watchVideoId, refreshPlayerLifecycle }', context);
  }
  return {
    window, document, context, config, configChangeEmitter, calls, load, loadLifecycle, advance,
    setPlayer: (value) => { player = value; },
    setVideo: (value) => { video = value; },
    countTimers: (interval) => Array.from(timers.values()).filter((t) => !!t.interval === interval).length,
    changeConfig(key, value) { config[key] = value; configChangeEmitter.emit('configChange', { detail: { key, value } }); },
  };
}

function makeVideo(src = 'one.mp4', playing = true) {
  const target = new Events();
  target.currentSrc = src;
  target.src = src;
  target.currentTime = 0;
  target.duration = 0;
  target.paused = !playing;
  target.ended = false;
  target.seeking = false;
  target.pauseCalls = 0;
  target.playCalls = 0;
  target.pause = () => { target.pauseCalls++; target.paused = true; target.emit('pause'); };
  target.play = () => { target.playCalls++; target.paused = false; target.emit('play'); return Promise.resolve(); };
  return target;
}

function makePlayer(videoId = 'one') {
  const target = new Events();
  target.videoId = videoId;
  target.isPlaying = true;
  target.getVideoData = () => ({ video_id: target.videoId });
  target.getPlayerStateObject = () => ({ isPlaying: target.isPlaying });
  target.getStatsForNerds = () => ({ resolution: '1920x1080@59.94' });
  target.getAvailableQualityData = () => [{ qualityLabel: '720p', quality: 'hd720' }, { qualityLabel: '1080p', quality: 'hd1080' }];
  target.qualityCalls = [];
  target.setPlaybackQualityRange = (...args) => target.qualityCalls.push(args);
  return target;
}

test('one lifecycle poller follows node and video identity and stops after unsubscribe', () => {
  const r = runtime();
  r.loadLifecycle();
  const players = [], videos = [], ids = [];
  const stopPlayer = r.context.lifecycle.watchPlayer((next) => players.push(next));
  const stopVideo = r.context.lifecycle.watchVideo((next) => videos.push(next));
  const stopId = r.context.lifecycle.watchVideoId((next) => ids.push(next));
  assert.equal(r.countTimers(true), 1);
  const p1 = makePlayer('one'), v1 = makeVideo();
  r.setPlayer(p1); r.setVideo(v1);
  r.advance(2000);
  assert.equal(players.at(-1), p1);
  assert.equal(videos.at(-1), v1);
  assert.equal(ids.at(-1), 'one');
  p1.videoId = 'two';
  r.advance(2000);
  assert.equal(ids.at(-1), 'two');
  const p2 = makePlayer('three'), v2 = makeVideo('two.mp4');
  r.setPlayer(p2); r.setVideo(v2);
  r.window.emit('hashchange');
  assert.equal(players.at(-1), p2);
  assert.equal(videos.at(-1), v2);
  assert.equal(ids.at(-1), 'three');
  stopPlayer(); stopVideo(); stopId();
  assert.equal(r.countTimers(true), 0);
  assert.equal(r.window.count('hashchange'), 0);
});

test('AFR only resumes its own uninterrupted media after the switch delay', () => {
  const r = runtime();
  const p1 = makePlayer(), v1 = makeVideo();
  r.setPlayer(p1); r.setVideo(v1);
  r.loadLifecycle();
  r.load('mods/features/autoFrameRate.js');
  p1.emit('onPlaybackStartExternal');
  assert.deepEqual(r.calls, [59.94]);
  assert.equal(v1.paused, true);
  r.advance(100);
  assert.equal(v1.playCalls, 1);

  p1.emit('onPlaybackStartExternal');
  r.window.location.hash = '#/watch?v=two';
  const p2 = makePlayer('two'), v2 = makeVideo('two.mp4');
  r.setPlayer(p2); r.setVideo(v2);
  r.window.emit('hashchange');
  r.advance(150);
  assert.equal(v1.playCalls, 1, 'old video must never be resumed');
  assert.equal(v2.playCalls, 0, 'new video must not be started by old timer');

  p2.emit('onPlaybackStartExternal');
  r.document.emit('keydown', { keyCode: 179 });
  r.advance(150);
  assert.equal(v2.playCalls, 0, 'remote pause intent cancels pending resume');

  v2.paused = true;
  p2.emit('onPlaybackStartExternal');
  r.advance(150);
  assert.equal(v2.playCalls, 0, 'already-paused video must stay paused');

  v2.paused = false;
  p2.emit('onPlaybackStartExternal');
  r.changeConfig('autoFrameRate', false);
  r.advance(150);
  assert.equal(v2.playCalls, 0, 'disabling AFR cancels pending resume');
  assert.equal(r.calls.at(-1), 0, 'disabling AFR restores frame rate');
});

test('speed and preferred quality detach from old nodes and follow reused player video ids', () => {
  const r = runtime();
  const p1 = makePlayer(), v1 = makeVideo();
  r.setPlayer(p1); r.setVideo(v1);
  r.loadLifecycle();
  r.context.showModal = () => {};
  r.context.buttonItem = () => {};
  r.context.overlayPanelItemListRenderer = () => {};
  r.load('mods/ui/speedUI.js');
  r.load('mods/features/preferredVideoQuality.js');
  assert.equal(v1.playbackRate, 1.5);
  assert.equal(v1.count('canplay'), 1);
  assert.equal(p1.count('onStateChange'), 1);
  assert.equal(p1.qualityCalls.length, 1);

  const v2 = makeVideo('two.mp4');
  r.setVideo(v2);
  p1.videoId = 'two';
  r.advance(2000);
  assert.equal(v1.count('canplay'), 0);
  assert.equal(v2.count('canplay'), 1);
  assert.equal(v2.playbackRate, 1.5);
  assert.equal(p1.qualityCalls.length, 2, 'new video id reapplies preferred quality');

  const p2 = makePlayer('three');
  r.setPlayer(p2);
  r.window.emit('hashchange');
  assert.equal(p1.count('onStateChange'), 0);
  assert.equal(p2.count('onStateChange'), 1);
  r.changeConfig('videoSpeed', 1.25);
  assert.equal(v2.playbackRate, 1.25);
  r.changeConfig('preferredVideoQuality', 'auto');
  assert.deepEqual(Array.from(p2.qualityCalls.at(-1)), ['auto', 'auto']);
});

test('SponsorBlock detaches media listeners and never skips a different route', async () => {
  const r = runtime();
  const v1 = makeVideo();
  r.setVideo(v1);
  r.loadLifecycle();
  r.context.sha256 = () => 'abcdef12';
  r.context.t = (s) => s;
  r.context.showToast = () => {};
  r.context.fetch = async () => ({
    ok: true,
    json: async () => [{ videoID: 'one', segments: [{ category: 'sponsor', UUID: 'seg-1', segment: [5, 9] }] }],
  });
  r.load('mods/features/sponsorblock.js');
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(r.context.window.sponsorblock, 'route handler initialized');
  assert.ok(r.context.window.sponsorblock.scheduleSkipHandler, 'segments loaded and installed');
  assert.equal(v1.count('timeupdate'), 1);
  const v2 = makeVideo('two.mp4');
  r.setVideo(v2);
  r.context.lifecycle.refreshPlayerLifecycle();
  assert.equal(v1.count('timeupdate'), 0);
  assert.equal(v2.count('timeupdate'), 1);

  r.window.location.hash = '#/watch?v=other';
  r.context.window.sponsorblock.performSkip({ category: 'sponsor', UUID: 'seg-1', segment: [5, 9] }, 9);
  assert.equal(v2.currentTime, 0);
  r.window.emit('hashchange');
  assert.equal(v2.count('timeupdate'), 0);
});
