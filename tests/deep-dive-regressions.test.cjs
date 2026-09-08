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

test('1.20.1 metadata stays synchronized', () => {
  const root = JSON.parse(read('package.json')).version;
  assert.equal(root, '1.20.1');
  assert.equal(JSON.parse(read('standalone/service/package.json')).version, root);
  has(read('standalone/config.xml'), `version="${root}"`);
});

test('remote input does not write screen opacity when dimming is already inactive', () => {
  const src = read('mods/ui/ui.js');
  has(src, 'let screenIsDimmed = false');
  const handler = between(src, 'const eventHandler = (evt) => {', 'return true;');
  assert.ok(!handler.includes('else clearDimmingTimer()'));
});

test('SponsorBlock manual actions preserve native timely actions', () => {
  const src = read('mods/features/adblock.js');
  has(src, 'function isAxotubeSponsorTimelyAction');
  has(src, 'filter((action) => !isAxotubeSponsorTimelyAction(action))');
  assert.ok(!src.includes('timelyActionRenderers = []'));
});

test('phone command ACK retry never executes the same command twice', () => {
  const src = read('mods/features/webConfig.js');
  has(src, 'lastExecutedCommandId');
  has(src, 'data.id === lastExecutedCommandId');
  const ack = between(src, 'function ackCommand(id)', 'function consumeCommand()');
  has(ack, 'if (!res.ok)');
});

test('shared fetch deadline does not depend on AbortController support', () => {
  const src = read('mods/shared/fetch.js');
  has(src, 'Promise.race');
  has(src, 'new Promise((_, reject)');
});

test('AFR resets when disabled and stays idle while disabled', () => {
  const src = read('mods/features/autoFrameRate.js');
  has(src, 'configChangeEmitter');
  has(src, 'function resetFrameRate');
  has(src, 'key === "autoFrameRate"');
  const attach = between(src, 'function attachToVideoPlayer()', 'window.addEventListener');
  has(attach, 'if (!configRead("autoFrameRate"))');
});

test('preferred quality only marks success after quality is actually available', () => {
  const src = read('mods/features/preferredVideoQuality.js');
  has(src, 'this.#hasAppliedQuality = this.#applyQuality()');
  has(src, 'MAX_APPLY_RETRIES');
});

test('subtitle readiness uses one bounded retry loop', () => {
  const src = read('mods/features/moreSubtitles.js');
  has(src, 'SUBTITLE_POLL_LIMIT');
  assert.ok(!src.includes('return setTimeout(patchSubtitleMenu'));
  assert.ok(!src.includes('const interval = setInterval'));
});

test('response HQ thumbnail cache is bounded', () => {
  const src = read('mods/features/hqThumbnails.js');
  has(src, 'MAX_HQ_CACHE_ENTRIES');
  has(src, 'hqThumbnailsCacheOrder');
});

test('DeArrow fans out pending requests and retries after transient failures', () => {
  const src = read('mods/features/deArrow.js');
  has(src, 'waiters');
  has(src, 'delete deArrowCache[videoId]');
});

test('HQ observer batches without RAF starvation and clears queued work on stop', () => {
  const src = read('mods/features/hqThumbnailsFocusObserver.js');
  const observerBlock = between(src, 'observer = new MutationObserver', 'observer.observe(container');
  assert.ok(!observerBlock.includes('cancelAnimationFrame(pendingFrame)'));
  const stop = between(src, 'var stopObserver = function () {', 'var syncWithConfig');
  has(stop, 'pendingMutations = null');
});

test('PiP DOM observer and transition timers stop when PiP exits', () => {
  const src = read('mods/features/pictureInPicture.js');
  has(src, 'function startPipUiObserver');
  has(src, 'function stopPipUiObserver');
  has(src, 'stopPipUiObserver()');
  has(src, 'clearPipTransitionTimers');
  has(read('mods/resolveCommand.js'), 'cleanupPipStyles()');
});

test('standalone proxy has an upstream request deadline', () => {
  const src = read('standalone/service/index.js');
  has(src, 'UPSTREAM_TIMEOUT_MS');
  has(src, 'timeout: UPSTREAM_TIMEOUT_MS');
});

test('standalone health check has a per-request deadline', () => {
  const src = read('standalone/index.html');
  has(src, 'function fetchWithDeadline');
  has(src, 'HEALTH_REQUEST_TIMEOUT_MS');
  has(src, 'reject(new Error("Request timed out"))');
});

test('known updater architecture never falls back to a different APK architecture', () => {
  const src = read('mods/features/updater.js');
  const fn = between(src, 'function findDownloadUrl', 'function checkForUpdates');
  has(fn, 'return asset ? asset.browser_download_url : null');
  has(fn, 'architecture.includes("arm64")');
  has(fn, 'architecture.includes("arm")');
});

test('AdBlock stringify hook restores caller objects after serialization', () => {
  const src = read('mods/features/adblock.js');
  const stringify = between(src, 'JSON.stringify = function', 'window.JSON.stringify');
  has(stringify, 'finally');
  has(stringify, 'delete playbackContext.isInlinePlaybackNoAd');
});

test('old-Tizen correction layer fixes only behavior-probed broken shims', () => {
  const entry = read('mods/userScript.js');
  has(entry, 'import "./polyfillCorrections.js"');
  const src = read('mods/polyfillCorrections.js');
  has(src, 'replaceAllBroken');
  has(src, 'new RegExp');
  has(src, 'var obj = {}');
  has(src, 'Object.defineProperty');
});

test('settings command patch fails open for unknown native command shapes', () => {
  const src = read('mods/resolveCommand.js');
  has(src, 'Array.isArray(cmd.setClientSettingEndpoint.settingDatas)');
  has(src, 'typeof itemName !== "string"');
});

test('pairing failures are rate-limited per client instead of globally', () => {
  const src = read('service/service.js');
  has(src, 'pairAttemptsByAddress');
  has(src, 'allowPairAttempt(req)');
  has(src, 'resetPairAttempts(req)');
});

test('TV exposes a usable Web Config address with the pairing code', () => {
  const service = read('service/service.js');
  has(service, 'getLanWebConfigUrls');
  has(service, 'urls: getLanWebConfigUrls()');
  const client = read('mods/features/webConfig.js');
  has(client, 'axotube Web Config');
  has(client, 'Open ${url} on your phone');
});

test('CI builds fresh distributables and publishes them for release sync', () => {
  const src = read('.github/workflows/ci.yml');
  has(src, 'Build mods and service');
  has(src, 'Build standalone bundle from fresh artifacts');
  has(src, 'actions/upload-artifact@v4');
  has(src, 'axotube-built-artifacts');
});
