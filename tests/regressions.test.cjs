const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.notEqual(a, -1, `missing start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing end marker: ${end}`);
  return source.slice(a, b);
}

test('core feature defaults remain enabled', () => {
  const config = read('mods/config.js');
  assert.match(config, /enableAdBlock:\s*true/);
  assert.match(config, /enableSponsorBlock:\s*true/);
  assert.match(config, /enableDeArrowTitles:\s*true/);
  assert.match(config, /enableDeArrowThumbnails:\s*true/);
  assert.match(config, /enableHqThumbnails:\s*true/);
  assert.match(config, /enablePatchingVideoPlayer:\s*true/);
});

test('AdBlock transformation still handles core ad response shapes', () => {
  const adblock = read('mods/features/adblock.js');
  for (const key of ['adPlacements', 'playerAds', 'adSlots', 'adSlotRenderer']) {
    assert.ok(adblock.includes(key), `AdBlock no longer handles ${key}`);
  }
});

test('persisted user agent cannot trigger an endless reload loop', () => {
  const src = read('mods/features/userAgentSpoofing.js');
  assert.match(src, /sessionStorage/);
  assert.match(src, /axotube-user-agent-applied/);
  const persistedBranch = between(src, "const ua = localStorage.getItem('userAgent');", 'const randomProfile');
  assert.doesNotMatch(persistedBranch, /location\.reload\(\)/);
});

test('phone command polling is independent from config sync lock', () => {
  const src = read('mods/features/webConfig.js');
  const fn = between(src, 'function consumeCommand()', 'function buildCommand');
  assert.doesNotMatch(fn, /\|\|\s*syncing/);
  const nowPlaying = between(src, 'function pushNowPlaying()', '// Small delay');
  assert.doesNotMatch(nowPlaying, /\|\|\s*syncing/);
});

test('command dispatch waits for a callable resolver', () => {
  const cast = read('mods/features/castReceiver.js');
  assert.match(cast, /canDispatch/);
  assert.doesNotMatch(cast, /Object\.keys\(window\._yttv\)\.length\s*>\s*0/);
});

test('cached UI resolver is invoked at most once even when it returns undefined', () => {
  const src = read('mods/ui/ytUI.js');
  const fn = between(src, 'function dispatchCommand', 'function canDispatch');
  assert.doesNotMatch(fn, /if\s*\(result\s*!==\s*undefined\)/);
});

test('Reduced Motion live handler can reach its flag helper', () => {
  const src = read('mods/ui/ui.js');
  const helper = src.indexOf('function applyReducedMotionFlags');
  const execute = src.indexOf('function execute_once_dom_loaded');
  assert.ok(helper !== -1 && helper < execute, 'applyReducedMotionFlags must be module scoped');
});

test('disabling dimming cancels pending dim timer and restores opacity', () => {
  const src = read('mods/ui/ui.js');
  assert.match(src, /enableScreenDimming[\s\S]{0,500}clearTimeout\(keyTimeout\)/);
  assert.match(src, /enableScreenDimming[\s\S]{0,800}opacity[\s\S]{0,100}["']1["']/);
});

test('auto frame rate resets when leaving watch, not entering watch', () => {
  const src = read('mods/features/autoFrameRate.js');
  assert.match(src, /function isWatchRoute/);
  assert.match(src, /hashchange[\s\S]{0,300}!isWatchRoute\(\)[\s\S]{0,300}SetFrameRate\(0\)/);
});

test('feature map discovery retries until the actual preview map appears', () => {
  const src = read('mods/features/enableFeatures.js');
  assert.match(src, /ENABLE_PREVIEWS_WITH_SOUND/);
  assert.match(src, /setTimeout\(enableFeatures/);
  assert.match(src, /if\s*\(!featureMap\)/);
});

test('mixed guide arrays cannot throw from the global JSON parser', () => {
  const src = read('mods/ui/customGuideAction.js');
  assert.match(src, /if\s*\(!section\s*\|\|\s*!Array\.isArray\(section\.items\)\)\s*continue/);
});

test('config recovery never clears unrelated localStorage', () => {
  const src = read('mods/config.js');
  assert.doesNotMatch(src, /localStorage\.clear\s*\(/);
  assert.match(src, /validateConfigValue/);
});

test('HQ thumbnail concurrent probes keep all callbacks and caches are bounded', () => {
  const src = read('mods/shared/hqThumbnails.js');
  assert.match(src, /hqPendingTesters\[videoId\]\.push\(onResult\)/);
  assert.match(src, /MAX_HQ_CACHE_ENTRIES/);
});

test('DeArrow accepts timestamp zero and bounds its cache', () => {
  const src = read('mods/features/deArrow.js');
  assert.match(src, /timestamp\s*!==\s*undefined/);
  assert.match(src, /MAX_DEARROW_CACHE_ENTRIES/);
});

test('long press respects disabled setting before modifying existing menus', () => {
  const src = read('mods/features/longPressMenu.js');
  const loop = between(src, 'export function addLongPress', 'export { makeQueuePayload }');
  const enabled = loop.indexOf('configRead("enableLongPress")');
  const existing = loop.indexOf('onLongPressCommand');
  assert.ok(enabled !== -1 && enabled < existing, 'toggle guard must run before native-menu mutation');
});

test('inline previews only attach to watch endpoints', () => {
  const src = read('mods/features/videoPreviews.js');
  assert.match(src, /onSelectCommand\?\.watchEndpoint/);
});

test('Hide Watched parses browseId regardless of query parameter ordering', () => {
  const src = read('mods/features/hideWatchedVideos.js');
  assert.match(src, /URLSearchParams|parseHashParams/);
});

test('queue tracks position rather than first matching duplicate video id', () => {
  const src = read('mods/features/videoQueuing.js');
  assert.match(src, /currentIndex/);
  assert.doesNotMatch(src, /findIndex\(v\s*=>\s*v\.tileRenderer\.contentId\s*===\s*videoData\.video_id\)/);
});

test('Who’s Watching disables its persistent interval when feature is disabled', () => {
  const src = read('mods/ui/disableWhosWatching.js');
  assert.match(src, /function clearPermanentInterval/);
  assert.match(src, /if\s*\(!value\)[\s\S]{0,250}clearPermanentInterval\(\)/);
});

test('theme preset mapping keeps distinct configured colors', () => {
  const resolve = read('mods/resolveCommand.js');
  assert.match(resolve, /darkGray:\s*["']#1c1a1a["']/);
  assert.match(resolve, /navy:\s*["']#0d1b2a["']/);
  assert.match(resolve, /darkRed:\s*["']#3b0505["']/);
  assert.match(resolve, /darkGreen:\s*["']#052e1b["']/);
  assert.match(resolve, /darkPurple:\s*["']#1a1025["']/);
});

test('standalone CORS bypass has explicit trusted-host validation', () => {
  const src = read('standalone/service/index.js');
  assert.match(src, /isAllowedCorsTarget/);
  assert.match(src, /googlevideo\.com/);
  assert.match(src, /127\.0\.0\.1|isPrivateHostname/);
});

test('release scripts cannot package stale bundles', () => {
  const root = JSON.parse(read('package.json'));
  assert.equal(root.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(root.scripts['build:standalone'], 'npm run build && node scripts/build-standalone.js');
  const pkg = read('scripts/package-wgt.ps1');
  assert.match(pkg, /npm run test/);
  assert.match(pkg, /npm run build:standalone/);
});

test('standalone version metadata matches root package version', () => {
  const rootVersion = JSON.parse(read('package.json')).version;
  const standaloneVersion = JSON.parse(read('standalone/service/package.json')).version;
  const xml = read('standalone/config.xml');
  assert.equal(standaloneVersion, rootVersion);
  assert.match(xml, new RegExp(`version=["']${rootVersion.replace(/\./g, '\\.')}`));
});
