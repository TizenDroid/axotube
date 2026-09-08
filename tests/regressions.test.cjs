const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const has = (src, text) => assert.ok(src.includes(text), `missing: ${text}`);

function between(src, start, end) {
  const a = src.indexOf(start);
  assert.notEqual(a, -1, `missing start marker: ${start}`);
  const b = src.indexOf(end, a + start.length);
  assert.notEqual(b, -1, `missing end marker: ${end}`);
  return src.slice(a, b);
}

test('core feature defaults stay enabled', () => {
  const d = JSON.parse(read('config-schema.json')).defaults;
  for (const key of [
    'enableAdBlock', 'enableSponsorBlock', 'enableDeArrowTitles',
    'enableDeArrowThumbnails', 'enableHqThumbnails',
    'enablePatchingVideoPlayer', 'enableLongPress', 'enablePreviews',
  ]) assert.equal(d[key], true, `${key} default changed`);
});

test('AdBlock still handles core ad response shapes', () => {
  const src = read('mods/features/adblock.js');
  for (const key of ['adPlacements', 'playerAds', 'adSlots', 'adSlotRenderer', 'promo']) has(src, key);
});

test('saved UA reload is session guarded', () => {
  const src = read('mods/features/userAgentSpoofing.js');
  has(src, "axotube-user-agent-applied");
  const branch = between(src, "const ua = localStorage.getItem('userAgent');", 'const randomProfile');
  has(branch, 'sessionStorage.getItem(USER_AGENT_APPLIED_SESSION_KEY) !== ua');
  has(branch, 'sessionStorage.setItem(USER_AGENT_APPLIED_SESSION_KEY, ua)');
  has(branch, 'location.reload()');
});

test('phone polling uses independent locks and explicit ACK', () => {
  const src = read('mods/features/webConfig.js');
  const consume = between(src, 'function consumeCommand()', 'function pushNowPlaying()');
  has(consume, 'commandPolling');
  assert.ok(!consume.includes('configSyncing'));
  const playing = between(src, 'function pushNowPlaying()', 'setTimeout(() =>');
  has(playing, 'nowPlayingPushing');
  assert.ok(!playing.includes('configSyncing'));
  has(src, '/api/command/ack');
  has(src, 'dispatchWhenReady(cmd).then((ok)');
});

test('cast waits for callable resolver', () => {
  const src = read('mods/features/castReceiver.js');
  has(src, 'function canDispatch');
  has(src, 'typeof candidate.instance.resolveCommand === "function"');
  assert.ok(!src.includes('Object.keys(window._yttv).length > 0'));
});

test('cached UI resolver cannot double-dispatch undefined result', () => {
  const fn = between(read('mods/ui/ytUI.js'), 'function dispatchCommand', 'function canDispatch');
  assert.ok(!fn.includes('result !== undefined'));
  has(fn, 'return cachedCommandRoot.instance.resolveCommand(cmd, _)');
});

test('Reduced Motion helper is module scoped and live', () => {
  const src = read('mods/ui/ui.js');
  assert.ok(src.indexOf('function applyReducedMotionFlags') < src.indexOf('function execute_once_dom_loaded'));
  has(src, 'key === "enableReducedMotion"');
});

test('dimming can be cancelled and restores opacity', () => {
  const src = read('mods/ui/ui.js');
  has(src, 'function clearDimmingTimer()');
  has(src, 'clearTimeout(keyTimeout)');
  has(src, 'restoreScreenOpacity()');
  has(src, 'key === "enableScreenDimming"');
});

test('AFR resets on leave-watch and reattaches', () => {
  const src = read('mods/features/autoFrameRate.js');
  has(src, 'function isWatchRoute()');
  has(src, 'if (!isWatchRoute())');
  has(src, 'SetFrameRate.call(window.h5vcc.tizentube, 0)');
  has(src, 'setTimeout(attachToVideoPlayer, 0)');
});

test('preview feature-map readiness retries actual capability', () => {
  const src = read('mods/features/enableFeatures.js');
  has(src, 'ENABLE_PREVIEWS_WITH_SOUND');
  has(src, 'if (!featureMap)');
  has(src, 'setTimeout(enableFeatures, 250)');
});

test('guide JSON patch fails open on mixed arrays', () => {
  const src = read('mods/ui/customGuideAction.js');
  has(src, 'if (!section || !Array.isArray(section.items)) continue');
  has(src, 'JSON.parse = function');
  has(src, 'try {');
});

test('config validates values and never clears unrelated storage', () => {
  const src = read('mods/config.js');
  has(src, 'validateConfigValue');
  has(src, 'configSchema.defaults');
  has(src, 'removeItem(CONFIG_KEY)');
  assert.ok(!src.includes('localStorage.clear('));
});

test('launchToOnStartup stays string-or-null across TV and web', () => {
  const cfg = read('mods/config.js');
  const web = read('service/webConfigPage.js');
  has(cfg, 'value === null || typeof value === "string"');
  has(web, 'key === "launchToOnStartup"');
  has(web, 'JSON.parse(v); state[key]=v');
});

test('HQ probes fan out and cache is bounded', () => {
  const src = read('mods/shared/hqThumbnails.js');
  has(src, 'hqPendingTesters[videoId].push(onResult)');
  has(src, 'MAX_HQ_CACHE_ENTRIES = 256');
});

test('DeArrow accepts timestamp zero and bounds cache', () => {
  const src = read('mods/features/deArrow.js');
  has(src, 'timestamp !== undefined');
  has(src, 'MAX_DEARROW_CACHE_ENTRIES = 256');
  has(src, 'if (!res.ok)');
});

test('long press toggle runs before native-menu mutation and queue action dedupes', () => {
  const src = read('mods/features/longPressMenu.js');
  const fn = between(src, 'export function addLongPress', 'export { makeQueuePayload }');
  assert.ok(fn.indexOf('configRead("enableLongPress")') < fn.indexOf('onLongPressCommand'));
  has(src, 'function hasQueueItem');
});

test('inline previews only target watch endpoints', () => {
  has(read('mods/features/videoPreviews.js'), 'onSelectCommand?.watchEndpoint');
});

test('Hide Watched parses browse id independently of query order', () => {
  const src = read('mods/features/hideWatchedVideos.js');
  has(src, 'function parseHashParams');
  has(src, 'params.browseId || params.browse_id');
});

test('queue uses positional state for duplicate ids', () => {
  const src = read('mods/features/videoQueuing.js');
  has(src, 'currentIndex');
  has(src, 'playQueueIndex(nextIndex)');
});

test('Who’s Watching interval is explicitly clearable', () => {
  const src = read('mods/ui/disableWhosWatching.js');
  has(src, 'function clearPermanentInterval');
  has(src, 'if (!value) clearPermanentInterval()');
  has(src, 'permanentlyEnableWhoIsWatchingMenu');
});

test('theme presets keep distinct colors and CSS inputs are sanitized', () => {
  const colors = JSON.parse(read('config-schema.json')).themePresetColors;
  assert.equal(colors.darkGray, '#1c1a1a');
  assert.equal(colors.navy, '#0d1b2a');
  assert.equal(colors.darkRed, '#3b0505');
  assert.equal(colors.darkGreen, '#052e1b');
  assert.equal(colors.darkPurple, '#1a1025');
  const theme = read('mods/ui/theme.js');
  has(theme, 'function safeColor');
  has(theme, 'function safeBackgroundUrl');
});

test('SponsorBlock initializes current route and clears pause scheduling', () => {
  const src = read('mods/features/sponsorblock.js');
  has(src, 'syncSponsorBlockForCurrentRoute()');
  has(src, 'DOMContentLoaded", syncSponsorBlockForCurrentRoute');
  has(src, 'if (this.video.paused)');
  has(src, 'this.clearScheduledSkip()');
  has(src, 'seg.segment[1] > currentTime + 0.05');
});

test('Auto quality releases fixed range and replacement player is watched', () => {
  const src = read('mods/features/preferredVideoQuality.js');
  has(src, 'setPlaybackQualityRange("auto", "auto")');
  has(src, 'this.#ensureCurrentPlayer(), 2000');
});

test('speed applies immediately and replacement video is watched', () => {
  const src = read('mods/ui/speedUI.js');
  has(src, 'applyConfiguredSpeed(boundVideo)');
  has(src, 'setInterval(attachVideo, 2000)');
});

test('PiP retries late services and cleans inline state', () => {
  const src = read('mods/features/pictureInPicture.js');
  has(src, 'MAX_PIP_LOAD_ATTEMPTS');
  has(src, 'function cleanupPipStyles');
  has(src, 'cleanupPipStyles()');
});

test('custom player patch initializes only after owner write succeeds', () => {
  const src = read('mods/ui/customUI.js');
  has(src, 'function makeRef');
  has(src, 'if (!ref.write(YtlrPlayerActionsContainer))');
  has(src, 'customUIInitialized = true');
});

test('LAN API is paired while loopback and DIAL remain functional', () => {
  const src = read('service/service.js');
  for (const text of [
    'function isLoopback', 'function requireApiAuth', 'app.post("/api/pair"',
    'app.use("/api", requireApiAuth)', 'app.post("/api/command/ack"',
    'prefix: "/dial"',
  ]) has(src, text);
});

test('successful pairing keeps the TV-displayed code valid for another phone', () => {
  const src = read('service/service.js');
  const route = between(src, 'app.post("/api/pair"', 'app.use("/api", requireApiAuth)');
  has(route, 'res.json({ ok: true, token: authToken })');
  assert.ok(!route.includes('pairingCode = newPairingCode()'), 'pairing must not silently rotate a code the TV only displayed once');
});

test('legacy persisted config migration keeps valid settings independently', () => {
  const src = read('service/service.js');
  const migration = between(src, 'function migrateStoredConfig', 'function loadStore()');
  has(migration, 'launchToOnStartup');
  has(migration, 'JSON.stringify');
  has(migration, 'continue');
  const loader = between(src, 'function loadStore()', 'const initialStore');
  has(loader, 'migrateStoredConfig(parsed.config)');
  assert.ok(!loader.includes('sanitizeConfig(parsed.config) || {}'), 'one invalid legacy value must not wipe all valid saved settings');
});

test('web config pairs and avoids innerHTML sinks', () => {
  const src = read('service/webConfigPage.js');
  has(src, 'axotube-pair-token');
  has(src, 'opts.headers.Authorization = "Bearer " + token');
  has(src, 'textContent');
  assert.ok(!src.includes('.innerHTML ='));
});

test('standalone proxy has trusted-host/private-host checks and strips credentials', () => {
  const src = read('standalone/service/index.js');
  for (const text of [
    'function isAllowedCorsTarget', 'function isPrivateHostname',
    'googlevideo.com', '127.', 'blocked.cookie = true',
    "app.listen(PORT, '127.0.0.1')",
  ]) has(src, text);
});

test('standalone startup guards Tizen APIs and bounds health retries', () => {
  const src = read('standalone/index.html');
  has(src, 'function safeRegisterKey');
  has(src, 'MAX_HEALTH_ATTEMPTS = 100');
  has(src, 'function sanitizeCastArgs');
});

test('updater compares versions and handles missing APK', () => {
  const src = read('mods/features/updater.js');
  has(src, 'function compareVersions');
  has(src, 'compareVersions(latestVersion, currentAppVersion) <= 0');
  has(src, 'if (!downloadUrl)');
});

test('release scripts force tests and fresh builds', () => {
  const root = JSON.parse(read('package.json'));
  assert.equal(root.scripts.test, 'node --test tests/*.test.cjs');
  assert.equal(root.scripts['build:standalone'], 'node scripts/build-standalone.js');
  has(read('scripts/build-standalone.js'), 'run("npm run build", ROOT)');
  const pkg = read('scripts/package-wgt.ps1');
  has(pkg, 'npm run test');
  has(pkg, 'npm run build:standalone');
});

test('standalone version metadata matches root', () => {
  const rootVersion = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('standalone/service/package.json')).version, rootVersion);
  has(read('standalone/config.xml'), `version="${rootVersion}"`);
});
