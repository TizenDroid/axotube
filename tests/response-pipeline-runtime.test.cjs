const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');

// Evaluate real feature modules with only their ESM import/export declarations
// removed. Dependencies that are irrelevant to response filtering are mocked;
// JSON and all global hooks are native, isolated VM intrinsics.
function runtime(overrides = {}) {
  const timers = [];
  const errors = [];
  const listeners = [];
  const settings = Object.assign({
    enableAdBlock: true,
    enableSigninReminder: false,
    enablePaidPromotionOverlay: false,
    enableHideEndScreenCards: true,
    enableYouThereRenderer: false,
    videoPreferredCodec: 'any',
    sponsorBlockManualSkips: [],
    enableSponsorBlockHighlight: false,
    disabledSidebarContents: ['EXPLORE'],
    disableChannelsOnSidebar: true,
  }, overrides.settings);
  const ctx = vm.createContext({
    console: { error: (...args) => errors.push(args), warn: () => {} },
    window: { queuedVideos: { videos: [], lastVideoId: '' } },
    setTimeout: (cb, interval) => { timers.push({ cb, interval }); return timers.length; },
    configRead: (key) => settings[key],
    configChangeEmitter: { addEventListener: (name, handler) => listeners.push({ name, handler }) },
    getCommandExecutor: () => null,
    PatchSettings: overrides.PatchSettings || (() => {}),
    timelyAction: () => ({}),
    ButtonRenderer: () => ({}),
    ShelfRenderer: () => ({}),
    TileRenderer: () => ({}),
    t: (key) => key,
    deArrowify: () => {},
    hqify: () => {},
    addLongPress: () => {},
    addPreviews: () => {},
    hideVideo: (items) => items,
  });
  const json = vm.runInContext('JSON', ctx);
  ctx.window.JSON = json;
  const nativeParse = json.parse;
  const nativeStringify = json.stringify;
  if (overrides.beforeHook) overrides.beforeHook(json);

  function evaluate(name) {
    const source = read(name)
      .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
      .replace(/^export\s+(?=function\s+)/gm, '');
    vm.runInContext(source, ctx, { filename: name });
  }

  evaluate('mods/ui/customGuideAction.js');
  evaluate('mods/shared/responsePipeline.js');
  evaluate('mods/features/adblock.js');
  return { json, nativeParse, nativeStringify, settings, ctx, timers, errors, listeners };
}

function guideFixture() {
  return {
    items: [
      null,
      { guideSectionRenderer: { items: [
        null,
        { guideEntryRenderer: { icon: { iconType: 'EXPLORE' } } },
        { guideEntryRenderer: { thumbnail: { thumbnails: [] } } },
        { guideEntryRenderer: { icon: { iconType: 'HOME' } } },
      ] } },
      { guideSectionRenderer: { items: null } },
    ],
  };
}

test('one global JSON.parse hook performs ordered ad and guide transforms', () => {
  const rt = runtime();
  const patched = rt.json.parse;
  assert.notEqual(patched, rt.nativeParse);
  assert.equal(rt.json.parse, rt.ctx.window.JSON.parse);
  const input = Object.assign(guideFixture(), {
    adPlacements: [{ ad: true }],
    playerAds: [{ ad: true }],
    adSlots: [{ ad: true }],
    paidContentOverlay: { ad: true },
    endscreen: { ad: true },
    messages: [{ youThereRenderer: {} }, { good: 1 }],
  });
  const result = patched(rt.nativeStringify(input));
  assert.equal(result.adPlacements.length, 0);
  assert.equal(result.playerAds, false);
  assert.equal(result.adSlots.length, 0);
  assert.equal(result.paidContentOverlay, null);
  assert.equal(result.endscreen, null);
  assert.equal(result.messages.length, 1);
  assert.equal(result.items[1].guideSectionRenderer.items.length, 2);
  assert.equal(result.items[1].guideSectionRenderer.items[1].guideEntryRenderer.icon.iconType, 'HOME');
  assert.equal(rt.timers.length, 1, 'only one native parser rebinding timer');
  assert.equal(rt.timers[0].interval, 250, 'late snapshots bound promptly during boot');
  assert.equal(rt.errors.length, 0);
  assert.equal(rt.listeners.length, 1, 'guide reload listener still installed');

  rt.settings.disabledSidebarContents = [];
  rt.settings.disableChannelsOnSidebar = false;
  const unfiltered = patched(rt.nativeStringify(guideFixture()));
  assert.equal(unfiltered.items[1].guideSectionRenderer.items.length, 4);
});

test('native parse revivers, receivers, errors, and primitive results survive interception', () => {
  const calls = [];
  const rt = runtime({ beforeHook: (json) => {
    const original = json.parse;
    json.parse = function parse() {
      calls.push({ receiver: this, arguments: Array.from(arguments) });
      return original.apply(this, arguments);
    };
  } });
  const receiver = { caller: 1 };
  const reviver = (key, value) => key === 'answer' ? value + 1 : value;
  assert.equal(rt.json.parse.call(receiver, '{"answer":41}', reviver).answer, 42);
  assert.equal(calls[0].receiver, receiver);
  assert.equal(calls[0].arguments[0], '{"answer":41}');
  assert.equal(calls[0].arguments[1], reviver);
  assert.equal(rt.json.parse.length, 2);
  assert.equal(rt.json.parse.name, 'parse');
  assert.equal(rt.json.parse('null'), null);
  assert.equal(rt.json.parse('7'), 7);
  assert.equal(rt.json.parse('"plain"'), 'plain');
  assert.throws(() => rt.json.parse('{invalid'), (err) => err.name === 'SyntaxError');
});

test('filters are fail-open independently, including after a failed AdBlock transform', () => {
  const rt = runtime({ PatchSettings: () => { throw Error('broken settings renderer'); } });
  const result = rt.json.parse(rt.nativeStringify(Object.assign(guideFixture(), {
    title: { runs: [{ text: 'Settings' }] },
    adPlacements: [{ ad: true }],
  })));
  assert.equal(result.adPlacements.length, 0);
  assert.equal(result.items[1].guideSectionRenderer.items.length, 2);
  assert.equal(rt.errors.length, 1);
  rt.json.parse('{"title":{"runs":[1]},"items":[]}');
  assert.equal(rt.errors.length, 1, 'repeat errors are logged only once');
});

test('late and replaced _yttv JSON namespaces receive the same parse hook', () => {
  const rt = runtime();
  const wrapped = rt.json.parse;
  const before = rt.nativeParse;
  rt.ctx.window._yttv = { early: { JSON: { parse: before } }, ignored: { stuff: 1 } };
  rt.timers[0].cb();
  assert.equal(rt.timers[1].interval, 2000, 'full scans slow after the first native parser');
  assert.equal(rt.ctx.window._yttv.early.JSON.parse, wrapped);
  const first = rt.ctx.window._yttv.early.JSON.parse('{"adSlots":[{}]}');
  assert.equal(first.adSlots.length, 0);

  const rejected = { JSON: {} };
  Object.defineProperty(rejected.JSON, 'parse', { get: () => before, set: () => { throw Error('read only'); } });
  rt.ctx.window._yttv = { failed: rejected, later: { JSON: { parse: before } } };
  rt.timers[0].cb();
  assert.equal(rt.ctx.window._yttv.later.JSON.parse, wrapped);
  const later = rt.ctx.window._yttv.later.JSON.parse('{"playerAds":[{}]}');
  assert.equal(later.playerAds, false);
});

test('missing native JSON modules do not cause unbounded rapid scans', () => {
  const rt = runtime();
  for (let i = 0; i < 20; i++) rt.timers[i].cb();
  assert.equal(rt.timers[20].interval, 2000);
});

test('JSON.stringify injects playback flag only during native serialization', () => {
  const calls = [];
  const rt = runtime({ beforeHook: (json) => {
    const original = json.stringify;
    json.stringify = function stringify() {
      calls.push({ receiver: this, arguments: Array.from(arguments) });
      return original.apply(this, arguments);
    };
  } });
  const input = { playbackContext: { contentPlaybackContext: { marker: 'kept' } } };
  const replacer = (key, value) => value;
  const receiver = { stringifyHost: true };
  const output = rt.json.stringify.call(receiver, input, replacer, 1, 'ignored-extra');
  assert.equal(calls[0].receiver, receiver);
  assert.deepEqual(calls[0].arguments, [input, replacer, 1, 'ignored-extra']);
  assert.equal(rt.nativeParse(output).playbackContext.contentPlaybackContext.isInlinePlaybackNoAd, true);
  assert.equal(Object.hasOwn(input.playbackContext.contentPlaybackContext, 'isInlinePlaybackNoAd'), false);

  const existing = { playbackContext: { contentPlaybackContext: { isInlinePlaybackNoAd: false } } };
  rt.json.stringify(existing);
  assert.equal(existing.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd, false);
  assert.throws(() => rt.json.stringify(existing, () => { throw Error('serialization broke'); }), /serialization broke/);
  assert.equal(existing.playbackContext.contentPlaybackContext.isInlinePlaybackNoAd, false);
});
