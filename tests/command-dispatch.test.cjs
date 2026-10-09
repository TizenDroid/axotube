const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');

const nativeModule = import(pathToFileURL(path.join(__dirname, '../mods/shared/nativeCommand.js')).href);

function loadPipWithFakeHost(host) {
  // Run the actual PiP implementation with its native adapter replaced by a
  // captured dispatcher. Nothing in this harness modifies the repository.
  const source = fs.readFileSync(path.join(__dirname, '../mods/features/pictureInPicture.js'), 'utf8')
    .replace(/^import \{[^\n]+\} from "\.\.\/shared\/nativeCommand\.js";\s*/m, '')
    .replace(/^export \{[^\n]+\};\s*$/m, '');
  const context = vm.createContext(host);
  vm.runInContext(source, context, { filename: 'pictureInPicture.js' });
  return context;
}

test('native dispatch calls the host exactly once even when it returns undefined', async (t) => {
  const native = await nativeModule;
  const calls = [];
  const instance = {
    resolveCommand(command, context) {
      assert.equal(this, instance);
      calls.push({ command, context });
      return undefined;
    },
  };
  global.window = { _yttv: { commandHost: { instance } } };
  t.after(() => { delete global.window; });

  const command = { browseEndpoint: { browseId: 'FEtopics' } };
  assert.equal(native.hasNativeResolver(), true);
  assert.deepEqual(native.tryDispatchNativeCommand(command, 'source'), {
    dispatched: true, result: undefined,
  });
  assert.deepEqual(calls, [{ command, context: 'source' }]);
  assert.equal(native.dispatchNativeCommand(command), undefined);
  assert.equal(calls.length, 2, 'each dispatch invokes once, irrespective of return value');
});

test('resolver cache follows root and method replacement without invoking stale hosts', async (t) => {
  const native = await nativeModule;
  let firstCalls = 0;
  let secondCalls = 0;
  const first = { resolveCommand() { assert.equal(this, first); firstCalls++; } };
  const second = { resolveCommand() { assert.equal(this, second); secondCalls++; } };
  const roots = { host: { instance: first } };
  global.window = { _yttv: roots };
  t.after(() => { delete global.window; });

  assert.equal(native.tryDispatchNativeCommand({ action: 1 }).dispatched, true);
  roots.host = { instance: second };
  native.dispatchNativeCommand({ action: 2 });
  roots.host.instance.resolveCommand = function () { assert.equal(this, second); secondCalls++; };
  native.dispatchNativeCommand({ action: 3 });
  global.window._yttv = { replacement: { instance: first } };
  native.dispatchNativeCommand({ action: 4 });
  assert.equal(firstCalls, 2);
  assert.equal(secondCalls, 2);
});

test('resolver discovery skips host getters that throw', async (t) => {
  const native = await nativeModule;
  const calls = [];
  const roots = {};
  Object.defineProperty(roots, 'broken', { enumerable: true, get() { throw Error('broken host'); } });
  roots.valid = { instance: { resolveCommand(command) { calls.push(command); } } };
  global.window = { _yttv: roots };
  t.after(() => { delete global.window; });

  assert.equal(native.tryDispatchNativeCommand({ signalAction: { signal: 'POPUP_BACK' } }).dispatched, true);
  assert.equal(calls.length, 1);
});

test('late readiness invokes once and treats undefined as an accepted call', async (t) => {
  const native = await nativeModule;
  const calls = [];
  global.window = { _yttv: {} };
  t.after(() => { delete global.window; });
  const command = { watchEndpoint: { videoId: 'video123' } };
  const promise = native.dispatchNativeCommandWhenReady(command, {
    maxAttempts: 25, retryDelayMs: 2,
  });
  setTimeout(() => {
    global.window._yttv.player = { instance: {
      resolveCommand(value) { calls.push(value); return undefined; },
    } };
  }, 5);
  assert.equal(await promise, true);
  assert.deepEqual(calls, [command]);
});

test('absence is safe to retry; attempted command is ACK-safe even after side effects then throw', async (t) => {
  const native = await nativeModule;
  global.window = { _yttv: {} };
  t.after(() => { delete global.window; });
  assert.equal(await native.dispatchNativeCommandWhenReady({ action: 1 }, {
    maxAttempts: 2, retryDelayMs: 1,
  }), false);
  const sideEffects = [];
  const receiver = { resolveCommand(command) {
    assert.equal(this, receiver, 'the throwing resolver keeps its native receiver');
    sideEffects.push(command);
    throw new Error('native failed after side effect');
  } };
  global.window._yttv.host = { instance: receiver };
  const command = { watchEndpoint: { videoId: 'video-after-throw' } };
  const originalWarn = console.warn;
  const warnings = [];
  let attempted;
  try {
    console.warn = (message) => warnings.push(message);
    attempted = await native.dispatchNativeCommandWhenReady(command, {
      maxAttempts: 5, retryDelayMs: 1,
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(attempted, true, 'caller must ACK this command ID even though resolver threw');
  assert.deepEqual(sideEffects, [command], 'native side effect must never be replayed');
  assert.equal(warnings.length, 1, 'diagnostics should report the native exception once');
});

test('patch registration covers existing and replacement roots without double-wrapping', async (t) => {
  const native = await nativeModule;
  const calls = [];
  let patches = 0;
  function makeInstance(label) {
    return { resolveCommand() { assert.equal(this, instanceByName[label]); calls.push(label); } };
  }
  const instanceByName = { a: null, b: null };
  instanceByName.a = makeInstance('a');
  instanceByName.b = makeInstance('b');
  global.window = { _yttv: { a: { instance: instanceByName.a } } };
  t.after(() => {
    native.registerNativeResolverPatcher(null);
    delete global.window;
  });
  native.registerNativeResolverPatcher((instance) => {
    if (instance.resolveCommand.__testPatched) return;
    patches++;
    const original = instance.resolveCommand;
    const wrapped = function (command, context) { return original.call(this, command, context); };
    wrapped.__testPatched = true;
    instance.resolveCommand = wrapped;
  });
  native.dispatchNativeCommand({ action: 1 });
  native.dispatchNativeCommand({ action: 2 });
  global.window._yttv.b = { instance: instanceByName.b };
  assert.equal(native.refreshNativeResolverPatches(), true);
  global.window._yttv = { b: { instance: instanceByName.b } };
  native.dispatchNativeCommand({ action: 3 });
  assert.deepEqual(calls, ['a', 'a', 'b']);
  assert.equal(patches, 2);
});

test('PiP return to fullscreen preserves the loaded playback config and native receiver semantics', () => {
  const commands = [];
  const originalWatch = Object.freeze({ videoId: 'first', startTimeSeconds: 6 });
  const originalConfig = Object.freeze({ watchEndpoint: originalWatch, clickTrackingParams: 'track' });
  const host = {
    window: { addEventListener() {} },
    document: {
      readyState: 'loading',
      querySelector(selector) {
        if (selector === 'video') return { currentTime: 42.8 };
        return null;
      },
    },
    tryDispatchNativeCommand(command) {
      commands.push(command);
      return { dispatched: true };
    },
    hasNativeResolver() { return true; },
    mockedPlayerService: { loadedPlaybackConfig: originalConfig },
    setTimeout, clearTimeout,
  };
  const context = loadPipWithFakeHost(host);
  vm.runInContext('PlayerService = mockedPlayerService; pipToFullscreen();', context);

  assert.equal(commands.length, 1);
  assert.equal(commands[0].watchEndpoint.startTimeSeconds, 42);
  assert.notEqual(commands[0].watchEndpoint, originalWatch);
  assert.equal(originalWatch.startTimeSeconds, 6);
  assert.equal(commands[0].clickTrackingParams, 'track');
});

test('PiP replay after HISTORY_BACK uses copied playback config', () => {
  const dispatched = [];
  const loaded = [];
  const timers = [];
  let observer = null;
  const originalWatch = Object.freeze({ videoId: 'first', startTimeSeconds: 5 });
  const originalConfig = Object.freeze({ watchEndpoint: originalWatch, playlistId: 'list' });
  const style = { removeProperty() {}, setProperty() {} };
  const player = { isConnected: true, style, classList: { contains() { return false; } } };
  const playerContainer = { isConnected: true, style };
  const video = { currentTime: 22.9, style, addEventListener() {} };
  const host = {
    window: { addEventListener() {} },
    document: {
      readyState: 'loading',
      querySelector(selector) {
        if (selector === 'video') return video;
        if (selector === 'ytlr-player') return player;
        if (selector === 'ytlr-player-container') return playerContainer;
        return null;
      },
    },
    tryDispatchNativeCommand(command) {
      dispatched.push(command);
      return { dispatched: true };
    },
    hasNativeResolver() { return true; },
    mockedPlayerService: {
      loadedPlaybackConfig: originalConfig,
      loadVideo(config) { loaded.push(config); },
    },
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observer = this; }
      observe() {}
      disconnect() {}
    },
    setTimeout(callback, delay) { timers.push({ callback, delay }); return timers.length; },
    clearTimeout() {},
  };
  const context = loadPipWithFakeHost(host);
  vm.runInContext('PlayerService = mockedPlayerService; enablePip();', context);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].signalAction.signal, 'HISTORY_BACK');
  assert.ok(observer, 'PiP should observe the transition');
  observer.callback([{ attributeName: 'class' }]);
  const reload = timers.find((entry) => entry.delay === 1000);
  assert.ok(reload, 'PiP should schedule playback transfer');
  reload.callback();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].watchEndpoint.startTimeSeconds, 22);
  assert.equal(loaded[0].playlistId, 'list');
  assert.notEqual(loaded[0], originalConfig);
  assert.notEqual(loaded[0].watchEndpoint, originalWatch);
  assert.equal(originalWatch.startTimeSeconds, 5);
});
