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

test('core feature defaults remain enabled in shared schema', () => {
  const defaults = JSON.parse(read('config-schema.json')).defaults;
  assert.equal(defaults.enableAdBlock, true);
  assert.equal(defaults.enableSponsorBlock, true);
  assert.equal(defaults.enableDeArrowTitles, true);
  assert.equal(defaults.enableDeArrowThumbnails, true);
  assert.equal(defaults.enableHqThumbnails, true);
  assert.equal(defaults.enablePatchingVideoPlayer, true);
  assert.equal(defaults.enableLongPress, true);
  assert.equal(defaults.enablePreviews, true);
});

test('AdBlock transformation still handles core ad response shapes', () => {
  const adblock = read('mods/features/adblock.js');
  for (const key of ['adPlacements', 'playerAds', 'adSlots', 'adSlotRenderer']) {
    assert.ok(adblock.includes(key), `AdBlock no longer handles ${key}`);
  }
});

test('persisted user agent reload is guarded by page-session marker', () => {
  const src = read('mods/features/userAgentSpoofing.js');
  assert.match(src, /USER_AGENT_APPLIED_SESSION_KEY\s*=\s*['"]axotube-user-agent-applied['"]/);
  const persisted = between(src, "const ua = localStorage.getItem('userAgent');", 'const randomProfile');
  assert.match(persisted, /sessionStorage\.getItem\(USER_AGENT_APPLIED_SESSION_KEY\)\s*!==\s*ua/);
  assert.match(persisted, /sessionStorage\.setItem\(USER_AGENT_APPLIED_SESSION_KEY, ua\)[\s\S]*location\.reload\(\)/);
});

test('phone command and now-playing polling use independent locks', () => {
  const src = read('mods/features/webConfig.js');
  const consume = between(src, 'function consumeCommand()', 'function pushNowPlaying()');
  assert.match(consume, /commandPolling/);
  assert.doesNotMatch(consume, /configSyncing/);
  const nowPlaying = between(src, 'function pushNowPlaying()', 'setTimeout(() =>');
  assert.match(nowPlaying, /nowPlayingPushing/);
  assert.doesNotMatch(nowPlaying, /configSyncing/);
});

test('phone command is acknowledged only through explicit ack endpoint', () => {
  const src = read('mods/features/webConfig.js');
  assert.match(src, /\/api\/command\/ack/);
  assert.match(src, /dispatchWhenReady\(cmd\)\.then\(\(ok\)/);
});

test('cast command dispatch waits for a callable resolver', () => {
  const cast = read('mods/features/castReceiver.js');
  assert.match(cast, /function canDispatch/);
  assert.match(cast, /typeof candidate\.instance\.resolveCommand === "function"/);
  assert.doesNotMatch(cast, /Object\.keys\(window\._yttv\)\.length\s*>\s*0/);
});

test('cached UI resolver is invoked at most once even when it returns undefined', () => {
  const src = read('mods/ui/ytUI.js');
  const fn = between(src, 'function dispatchCommand', 'function canDispatch');
  assert.doesNotMatch(fn, /result\s*!==\s*undefined/);
  assert.match(fn, /return cachedCommandRoot\.instance\.resolveCommand\(cmd, _\)/);
});

test('Reduced Motion live handler can reach its module-scope flag helper', () => {
  const src = read('mods/ui/ui.js');
  const helper = src.indexOf('function applyReducedMotionFlags');
  const execute = src.indexOf('function execute_once_dom_loaded');
  assert.ok(helper !== -1 && helper < execute, 'applyReducedMotionFlags must be module scoped');
  assert.match(src, /key === "enableReducedMotion"[\s\S]*applyReducedMotionFlags\(\)/);
});

test('disabling dimming cancels pending timer and restores opacity', () => {
  const src = read('mods/ui/ui.js');
  assert.match(src, /function clearDimmingTimer\(\)[\s\S]*clearTimeout\(keyTimeout\)[\s\S]*restoreScreenOpacity\(\)/);
  assert.match(src, /key === "enableScreenDimming"[\s\S]*clearDimmingTimer\(\)/);
  assert.match(src, /if \(!configRead\("enableScreenDimming"\)\)[\s\S]*restoreScreenOpacity\(\)/);
});

test('auto frame rate resets when leaving watch and reattaches player', () => {
  const src = read('mods/features/autoFrameRate.js');
  assert.match(src, /function isWatchRoute/);
  assert.match(src, /hashchange[\s\S]*if \(!isWatchRoute\(\)\)[\s\S]*SetFrameRate\.call\([\s\S]*, 0\)/);
  assert.match(src, /setTimeout\(attachToVideoPlayer, 0\)/);
});

test('feature map discovery retries until actual preview map appears', () => {
  const src = read('mods/features/enableFeatures.js');
  assert.match(src, /ENABLE_PREVIEWS_WITH_SOUND/);
  assert.match(src, /if \(!featureMap\)[\s\S]*setTimeout\(enableFeatures, 250\)/);
});

test('mixed guide arrays cannot throw from global JSON parser', () => {
  const src = read('mods/ui/customGuideAction.js');
  assert.match(src, /if \(!section \|\| !Array\.isArray\(section\.items\)\) continue/);
  assert.match(src, /JSON\.parse = function[\s\S]*try \{/);
});

test('config recovery never clears unrelated localStorage and validates writes', () => {
  const src = read('mods/config.js');
  assert.doesNotMatch(src, /localStorage\.clear\s*\(/);
  assert.match(src, /validateConfigValue/);
  assert.match(src, /removeItem\(CONFIG_KEY\)/);
  assert.match(src, /configSchema\.defaults/);
});

test('launchToOnStartup keeps one string-or-null representation', () => {
  const config = read('mods/config.js');
  const web = read('service/webConfigPage.js');
  assert.match(config, /expected === null[\s\S]*value === null \|\| typeof value === "string"/);
  assert.match(web, /key === "launchToOnStartup"/);
  assert.match(web, /JSON\.parse\(v\); state\[key\]=v/);
});

test('HQ thumbnail concurrent probes fan out callbacks and bound cache', () => {
  const src = read('mods/shared/hqThumbnails.js');
  assert.match(src, /hqPendingTesters\[videoId\]\.push\(onResult\)/);
  assert.match(src, /MAX_HQ_CACHE_ENTRIES\s*=\s*256/);
});

test('DeArrow accepts timestamp zero and bounds its cache', () => {
  const src = read('mods/features/deArrow.js');
  assert.match(src, /timestamp !== undefined/);
  assert.match(src, /MAX_DEARROW_CACHE_ENTRIES\s*=\s*256/);
  assert.match(src, /if \(!res\.ok\)/);
});

test('long press respects disabled setting before modifying existing menus', () => {
  const src = read('mods/features/longPressMenu.js');
  const fn = between(src, 'export function addLongPress', 'export { makeQueuePayload }');
  const enabled = fn.indexOf('configRead("enableLongPress")');
  const existing = fn.indexOf('onLongPressCommand');
  assert.ok(enabled !== -1 && enabled < existing, 'toggle guard must run before native-menu mutation');
  assert.match(src, /function hasQueueItem/);
});

test('inline previews only attach to watch endpoints', () => {
  const src = read('mods/features/videoPreviews.js');
  assert.match(src, /onSelectCommand\?\.watchEndpoint/);
});

test('Hide Watched parses browseId regardless of query parameter ordering', () => {
  const src = read('mods/features/hideWatchedVideos.js');
  assert.match(src, /function parseHashParams/);
  assert.match(src, /params\.browseId \|\| params\.browse_id/);
});

test('queue tracks position instead of first duplicate video id', () => {
  const src = read('mods/features/videoQueuing.js');
  assert.match(src, /currentIndex/);
  assert.match(src, /playQueueIndex\(nextIndex\)/);
});

test('Who’s Watching clears persistent interval when disabled', () => {
  const src = read('mods/ui/disableWhosWatching.js');
  assert.match(src, /function clearPermanentInterval/);
  assert.match(src, /if \(!value\) clearPermanentInterval\(\)/);
  assert.match(src, /permanentlyEnableWhoIsWatchingMenu/);
});

test('theme presets keep their distinct configured colors', () => {
  const schema = JSON.parse(read('config-schema.json')).themePresetColors;
  assert.equal(schema.darkGray, '#1c1a1a');
  assert.equal(schema.navy, '#0d1b2a');
  assert.equal(schema.darkRed, '#3b0505');
  assert.equal(schema.darkGreen, '#052e1b');
  assert.equal(schema.darkPurple, '#1a1025');
  const resolve = read('mods/resolveCommand.js');
  assert.match(resolve, /darkGray: "#1c1a1a"/);
});

test('theme values are sanitized before CSS interpolation', () => {
  const src = read('mods/ui/theme.js');
  assert.match(src, /function safeColor/);
  assert.match(src, /function safeBackgroundUrl/);
  assert.match(src, /\^\[A-Za-z0-9_-\]\+\$/);
});

test('SponsorBlock initializes current route and clears paused skip timers', () => {
  const src = read('mods/features/sponsorblock.js');
  assert.match(src, /syncSponsorBlockForCurrentRoute\(\)/);
  assert.match(src, /DOMContentLoaded", syncSponsorBlockForCurrentRoute/);
  assert.match(src, /if \(this\.video\.paused\)[\s\S]*this\.clearScheduledSkip\(\)/);
  assert.match(src, /seg\.segment\[1\] > currentTime \+ 0\.05/);
});

test('preferred quality releases fixed range when Auto is selected', () => {
  const src = read('mods/features/preferredVideoQuality.js');
  assert.match(src, /setPlaybackQualityRange\("auto", "auto"\)/);
  assert.match(src, /setInterval\(\(\) => this\.#ensureCurrentPlayer\(\), 2000\)/);
});

test('speed control applies immediately and watches replacement video', () => {
  const src = read('mods/ui/speedUI.js');
  assert.match(src, /applyConfiguredSpeed\(boundVideo\)/);
  assert.match(src, /setInterval\(attachVideo, 2000\)/);
});

test('PiP retries late services and cleans inline styles on exit', () => {
  const src = read('mods/features/pictureInPicture.js');
  assert.match(src, /MAX_PIP_LOAD_ATTEMPTS/);
  assert.match(src, /function cleanupPipStyles/);
  assert.match(src, /cleanupPipStyles\(\)/);
});

test('custom player patch only initializes after owner write succeeds', () => {
  const src = read('mods/ui/customUI.js');
  assert.match(src, /function makeRef/);
  assert.match(src, /if \(!ref\.write\(YtlrPlayerActionsContainer\)\)/);
  assert.match(src, /customUIInitialized = true/);
});

test('LAN API requires pairing while loopback remains automatic', () => {
  const src = read('service/service.js');
  assert.match(src, /function isLoopback/);
  assert.match(src, /function requireApiAuth/);
  assert.match(src, /app\.post\("\/api\/pair"/);
  assert.match(src, /app\.use\("\/api", requireApiAuth\)/);
  assert.match(src, /app\.post\("\/api\/command\/ack"/);
});

test('web config uses pairing token and avoids innerHTML sinks', () => {
  const src = read('service/webConfigPage.js');
  assert.match(src, /axotube-pair-token/);
  assert.match(src, /Authorization = "Bearer " \+ token/);
  assert.doesNotMatch(src, /\.innerHTML\s*=/);
  assert.match(src, /textContent/);
});

test('standalone CORS bypass has explicit trusted-host validation', () => {
  const src = read('standalone/service/index.js');
  assert.match(src, /function isAllowedCorsTarget/);
  assert.match(src, /function isPrivateHostname/);
  assert.match(src, /googlevideo\.com/);
  assert.match(src, /127\\\.\/);
  assert.match(src, /blocked\.cookie = true/);
  assert.match(src, /app\.listen\(PORT, '127\.0\.0\.1'\)/);
});

test('standalone startup guards Tizen key registration and bounds health retries', () => {
  const src = read('standalone/index.html');
  assert.match(src, /function safeRegisterKey/);
  assert.match(src, /MAX_HEALTH_ATTEMPTS\s*=\s*100/);
  assert.match(src, /function sanitizeCastArgs/);
});

test('updater only offers truly newer versions and guards APK lookup', () => {
  const src = read('mods/features/updater.js');
  assert.match(src, /function compareVersions/);
  assert.match(src, /compareVersions\(latestVersion, currentAppVersion\) <= 0/);
  assert.match(src, /if \(!downloadUrl\)/);
});

test('release scripts cannot package stale bundles', () => {
  const root = JSON.parse(read('package.json'));
  assert.equal(root.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(root.scripts['build:standalone'], 'node scripts/build-standalone.js');
  const standaloneBuild = read('scripts/build-standalone.js');
  assert.match(standaloneBuild, /run\("npm run build", ROOT\)/);
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
