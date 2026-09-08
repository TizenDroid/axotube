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
  assert.ok(!handler.includes('else clearDimmingTimer()'), 'disabled dimming must not write opacity on every key event');
});

test('SponsorBlock manual actions preserve native timely actions', () => {
  const src = read('mods/features/adblock.js');
  has(src, 'function isAxotubeSponsorTimelyAction');
  has(src, 'filter((action) => !isAxotubeSponsorTimelyAction(action))');
  assert.ok(!src.includes('timelyActionRenderers = []'), 'disabling manual skips must not erase native YouTube timed actions');
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
  assert.ok(!src.includes('return setTimeout(patchSubtitleMenu'), 'recursive retry must not run alongside the poll loop');
  assert.ok(!src.includes('const interval = setInterval'), 'subtitle patching should use one bounded scheduler');
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
  assert.ok(!observerBlock.includes('cancelAnimationFrame(pendingFrame)'), 'continuous mutations must not postpone processing forever');
  const stop = between(src, 'var stopObserver = function () {', 'var syncWithConfig');
  has(stop, 'pendingMutations = null');
});

test('PiP DOM observer and transition timers stop when PiP exits', () => {
  const src = read('mods/features/pictureInPicture.js');
  has(src, 'function startPipUiObserver');
  has(src, 'function stopPipUiObserver');
  has(src, 'stopPipUiObserver()');
  has(src, 'clearPipTransitionTimers');
});

test('standalone proxy has an upstream request deadline', () => {
  const src = read('standalone/service/index.js');
  has(src, 'timeout: UPSTREAM_TIMEOUT_MS');
});

test('standalone health check has a per-request deadline', () => {
  const src = read('standalone/index.html');
  has(src, 'function fetchWithDeadline');
  has(src, 'Promise.race');
});

test('known updater architecture never falls back to a different APK architecture', () => {
  const src = read('mods/features/updater.js');
  has(src, 'return asset ? asset.browser_download_url : null');
});

test('AdBlock stringify hook restores caller objects after serialization', () => {
  const src = read('mods/features/adblock.js');
  const stringify = between(src, 'JSON.stringify = function', 'window.JSON.stringify');
  has(stringify, 'finally');
  has(stringify, 'delete playbackContext.isInlinePlaybackNoAd');
});

test('old-Tizen polyfills preserve replaceAll callback semantics and normal objects', () => {
  const src = read('mods/polyfills.js');
  const replaceAll = between(src, 'String.prototype.replaceAll = function', '// ─────────────────────────────────────────────────────────────────────────────\n// Object.entries');
  has(replaceAll, 'new RegExp');
  const fromEntries = between(src, 'Object.fromEntries = function', '// ─────────────────────────────────────────────────────────────────────────────\n// queueMicrotask');
  has(fromEntries, 'var obj = {}');
  has(fromEntries, 'Object.defineProperty');
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
});

test('CI fails when committed dist is stale after a build', () => {
  const src = read('.github/workflows/ci.yml');
  has(src, 'git diff --exit-code -- dist');
});
