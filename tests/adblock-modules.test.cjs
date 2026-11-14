// Tests for the modular ad filters: banner, player tracking, optional shelves,
// empty-shelf cleanup, bounded fallback, telemetry hooks, circuit breaker,
// text pre-scan, and the recommendation-safety rules.
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadBundle } = require("./helpers/adblockBundle.cjs");

const BASE = {
  enableAdBlock: true,
  enableShorts: true,
  enableSigninReminder: false,
  enablePaidPromotionOverlay: false,
  enableHideEndScreenCards: false,
  enableYouThereRenderer: true,
  enableSponsorBlockHighlight: false,
  sponsorBlockManualSkips: [],
  videoPreferredCodec: "any",
  sortSubscriptionsByAlphabet: false,
  blockPlayerAdTracking: true,
  blockAdTelemetry: true,
  blockViewStatsTelemetry: false,
  removeLiveVideos: false,
  removeTopLiveGames: false,
  removeMostRelevant: false,
};

const tile = (id) => ({ tileRenderer: { contentId: id } });
const shelf = (title, items) => ({
  shelfRenderer: { title: { runs: [{ text: title }] }, content: { horizontalListRenderer: { items } } },
});
const browse = (contents) => ({
  contents: {
    tvBrowseRenderer: {
      content: { tvSurfaceContentRenderer: { content: { sectionListRenderer: { contents } } } },
    },
  },
});
const titlesOf = (json) =>
  json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.map(
    (s) => (s.shelfRenderer ? s.shelfRenderer.title.runs[0].text : Object.keys(s)[0]),
  );
const browseContents = (json) =>
  json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;

function run(settings, json, text) {
  const { filters } = loadBundle(Object.assign({}, BASE, settings));
  filters[0](json, text);
  return json;
}

test("full-width home banner (tvMastheadRenderer) is removed; recommendation shelves stay", () => {
  const json = browse([
    { tvMastheadRenderer: { title: "banner" } },
    shelf("Recommended", [tile("a")]),
    shelf("Recommended live", [tile("b")]),
  ]);
  run({ removeLiveVideos: true, removeTopLiveGames: true, removeMostRelevant: true }, json);
  assert.deepEqual(titlesOf(json), ["Recommended", "Recommended live"]);
});

test("optional shelves are removed only when their own toggle is on", () => {
  const liveJson = browse([shelf("Live", [tile("1")]), shelf("Live now", [tile("2")])]);
  run({ removeLiveVideos: true }, liveJson);
  assert.deepEqual(titlesOf(liveJson), []);

  const topJson = browse([shelf("Top live games", [tile("3")]), shelf("Live", [tile("4")])]);
  run({ removeTopLiveGames: true }, topJson);
  assert.deepEqual(titlesOf(topJson), ["Live"]);

  const relJson = browse([shelf("Most relevant", [tile("5")])]);
  run({ removeMostRelevant: true }, relJson);
  assert.deepEqual(titlesOf(relJson), []);

  const offJson = browse([shelf("Live", [tile("6")]), shelf("Most relevant", [tile("7")])]);
  run({}, offJson);
  assert.deepEqual(titlesOf(offJson), ["Live", "Most relevant"]);
});

test("a recommendation shelf is never removed by the optional toggles", () => {
  const json = browse([shelf("Live recommendations", [tile("r")]), shelf("Most relevant recommended", [tile("s")])]);
  run({ removeLiveVideos: true, removeMostRelevant: true }, json);
  assert.deepEqual(titlesOf(json), ["Live recommendations", "Most relevant recommended"]);
});

test("a shelf emptied by our ad filter is removed, but an already-empty shelf is left alone", () => {
  const json = browse([
    shelf("Only ad", [{ adSlotRenderer: {} }]),
    shelf("Already empty", []),
    shelf("Keeps content", [{ adSlotRenderer: {} }, tile("x")]),
  ]);
  run({}, json);
  assert.deepEqual(titlesOf(json), ["Already empty", "Keeps content"]);
});

test("player ad tracking (attestation, adBreakHeartbeatParams) is stripped, including nested playerResponse", () => {
  const make = () => ({
    attestation: { a: 1 },
    adBreakHeartbeatParams: "x",
    streamingData: {},
    playerResponse: { attestation: { b: 2 }, adBreakHeartbeatParams: "y", videoDetails: {} },
  });
  const on = run({}, make());
  assert.equal("attestation" in on, false);
  assert.equal("adBreakHeartbeatParams" in on, false);
  assert.equal("attestation" in on.playerResponse, false);
  assert.equal("adBreakHeartbeatParams" in on.playerResponse, false);
  assert.ok(on.playerResponse.videoDetails, "other player fields kept");

  const off = run({ blockPlayerAdTracking: false }, make());
  assert.ok("attestation" in off);
  assert.ok("attestation" in off.playerResponse);
});

test("text pre-scan: responses without ad markers are judged ad-free; unknown text is scanned", () => {
  const { ctx } = loadBundle(BASE);
  assert.equal(ctx.textMayHaveAds('{"contents":{"plain":"hello"}}'), false);
  assert.equal(ctx.textMayHaveAds('{"adSlotRenderer":{}}'), true);
  assert.equal(ctx.textMayHaveAds(undefined), true);
});

test("bounded fallback finds an ad key at depth 8 and ignores depth 9", () => {
  const { ctx } = loadBundle(BASE);
  const root = {};
  let node = root;
  for (let i = 0; i < 8; i++) {
    node.c = {};
    node = node.c;
  }
  node.playerAds = true; // depth 8: searched
  node.c = { playerAds: true }; // depth 9: beyond the limit
  const result = ctx.boundedAdSearch(root, { player: false });
  assert.equal(node.playerAds, false);
  assert.equal(node.c.playerAds, true);
  assert.equal(result.removed, 1);
});

test("bounded fallback stops at the node cap and reports truncation", () => {
  const { ctx } = loadBundle(BASE);
  const list = [];
  for (let i = 0; i < 3000; i++) list.push({ adSlots: [1] });
  const root = { list };
  const result = ctx.boundedAdSearch(root, { player: false });
  assert.equal(result.truncated, true);
  assert.ok(result.removed < 3000, "not every item is reached under the cap");
});

test("bounded fallback removes only exact ad keys, never content items", () => {
  const { ctx } = loadBundle(BASE);
  const root = { list: [tile("keep"), { adSlotRenderer: {} }, { tileRenderer: { contentId: "keep2" } }] };
  ctx.boundedAdSearch(root, { player: false });
  assert.deepEqual(root.list.map((i) => Object.keys(i)[0]), ["tileRenderer", "tileRenderer"]);
});

test("large response: fallback runs after known paths and keeps recommendations", () => {
  const padding = "x".repeat(11000);
  const json = browse([
    { tvMastheadRenderer: {} },
    shelf("Recommended", [tile("a"), { adSlotRenderer: {} }]),
    { promoShelfRenderer: { pad: padding } },
  ]);
  const text = JSON.stringify(json) + padding;
  const { filters, window } = loadBundle(BASE);
  filters[0](json, text);
  assert.deepEqual(titlesOf(json), ["Recommended"]);
  assert.equal(json.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer.items.length, 1);
  assert.ok(window.__axotubeAdblockStats.bannerRemoved >= 1);
});

test("telemetry rules: ad tracking on by default, view stats off, log_event never blocked", () => {
  const { ctx } = loadBundle(BASE);
  const on = { ads: true, viewStats: false };
  assert.equal(ctx.shouldBlockRequestUrl("https://x/pagead/conversion", on), true);
  assert.equal(ctx.shouldBlockRequestUrl("https://x/ptracking?a=1", on), true);
  assert.equal(ctx.shouldBlockRequestUrl("https://x/eligibility_check", on), true);
  assert.equal(ctx.shouldBlockRequestUrl("https://x/api/stats/qoe", on), false);
  assert.equal(ctx.shouldBlockRequestUrl("https://x/youtubei/v1/log_event", { ads: true, viewStats: true }), false);
  assert.equal(ctx.shouldBlockRequestUrl("https://x/api/stats/watchtime", { ads: true, viewStats: true }), true);
  assert.equal(ctx.shouldBlockRequestUrl("https://x/pagead/x", { ads: false, viewStats: true }), false);
});

test("telemetry hooks: XHR rewritten to a blank JSON document, fetch and beacon blocked, others pass", () => {
  const calls = [];
  function FakeXHR() {}
  FakeXHR.prototype.open = function (method, url) {
    calls.push(["xhr", method, url]);
  };
  const win = {
    XMLHttpRequest: FakeXHR,
    fetch: (input) => {
      calls.push(["fetch", input]);
      return Promise.resolve("ok");
    },
    navigator: {
      sendBeacon: (url) => {
        calls.push(["beacon", url]);
        return true;
      },
    },
  };
  const { ctx } = loadBundle(BASE);
  ctx.installTelemetryHooks(win);

  new win.XMLHttpRequest().open("POST", "https://x/pagead/y", true);
  new win.XMLHttpRequest().open("POST", "https://x/youtubei/v1/log_event", true);
  win.fetch("https://x/ptracking?q");
  win.fetch("https://x/youtubei/v1/next");
  assert.equal(win.navigator.sendBeacon("https://x/pagead/z"), true);

  assert.deepEqual(calls[0], ["xhr", "GET", "data:application/json,{}"]);
  assert.deepEqual(calls[1], ["xhr", "POST", "https://x/youtubei/v1/log_event"]);
  assert.deepEqual(calls[2], ["fetch", "data:application/json,{}"]);
  assert.deepEqual(calls[3], ["fetch", "https://x/youtubei/v1/next"]);
  assert.equal(calls.length, 4, "beacon to a blocked URL is not sent");
});

test("circuit breaker: a filter section is disabled after 5 errors, with one warning", () => {
  const { ctx } = loadBundle(BASE);
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    let calls = 0;
    for (let i = 0; i < 9; i++) {
      ctx.runGuarded("test-section", () => {
        calls++;
        throw new Error("boom");
      });
    }
    assert.equal(calls, 5, "the section runs until the breaker opens");
    assert.equal(warnings.length, 1);
  } finally {
    console.warn = originalWarn;
  }
});

test("playback stringify fix sets the no-ad flag only during the call and restores the caller's object", () => {
  const { window } = loadBundle(BASE);
  const ctxObj = { playbackContext: { contentPlaybackContext: {} } };
  const out = window.JSON.stringify(ctxObj);
  assert.ok(out.indexOf('"isInlinePlaybackNoAd":true') !== -1);
  assert.equal(
    Object.prototype.hasOwnProperty.call(ctxObj.playbackContext.contentPlaybackContext, "isInlinePlaybackNoAd"),
    false,
  );
});

test("stats counters record what was removed", () => {
  const json = browse([shelf("Only ad", [{ adSlotRenderer: {} }])]);
  const { filters, window } = loadBundle(BASE);
  filters[0](json);
  assert.equal(window.__axotubeAdblockStats.emptyShelfRemoved, 1);
});
