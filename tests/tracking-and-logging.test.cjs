"use strict";
// Two performance switches taken from the reference forks. Strip tracking tokens: the parse
// sees blank trackingParams, the filters still see the original text, and clickTrackingParams
// is not touched. Block event logging: only log_event, only when its setting is on.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function pipelineWith(cfg) {
  const ctx = vm.createContext({
    window: {},
    setTimeout: () => 0,
    console,
    configRead: (key) => cfg[key],
  });
  vm.runInContext(blankSyntax(read("mods/shared/responsePipeline.js")), ctx, { filename: "responsePipeline.js" });
  // The context's own JSON (the one the pipeline wraps), not a host object.
  ctx.JSON = vm.runInContext("JSON", ctx);
  return ctx;
}

const RESPONSE = JSON.stringify({
  contents: [
    {
      tileRenderer: {
        contentId: "abc",
        trackingParams: "CAEQlYkGGhMI123",
        clickTrackingParams: "CAEQlYkGKeep456",
        title: "Keep me",
      },
    },
  ],
});

test("tracking tokens are blank after the parse; click tokens and other data are untouched", () => {
  const ctx = pipelineWith({ stripTrackingParams: true });
  const seen = [];
  ctx.installResponsePipeline([(result, text) => seen.push(text)]);
  const out = ctx.JSON.parse(RESPONSE);
  const tile = out.contents[0].tileRenderer;
  assert.equal(tile.trackingParams, "");
  assert.equal(tile.clickTrackingParams, "CAEQlYkGKeep456");
  assert.equal(tile.title, "Keep me");
  assert.equal(tile.contentId, "abc");
});

test("the response filters still get the original text, so their pre-scans are unchanged", () => {
  const ctx = pipelineWith({ stripTrackingParams: true });
  const seen = [];
  ctx.installResponsePipeline([(result, text) => seen.push(text)]);
  ctx.JSON.parse(RESPONSE);
  assert.equal(seen[0], RESPONSE);
});

test("with the setting off, the parse is unchanged", () => {
  const ctx = pipelineWith({ stripTrackingParams: false });
  ctx.installResponsePipeline([]);
  const out = ctx.JSON.parse(RESPONSE);
  assert.equal(out.contents[0].tileRenderer.trackingParams, "CAEQlYkGGhMI123");
});

test("a response with no tracking tokens is parsed as it is, with no text rewrite needed", () => {
  const ctx = pipelineWith({ stripTrackingParams: true });
  ctx.installResponsePipeline([]);
  // Compared as text: the parsed object belongs to the test context, not this realm.
  assert.equal(JSON.stringify(ctx.JSON.parse('{"a":[1,2,{"b":"c"}]}')), '{"a":[1,2,{"b":"c"}]}');
});

// ---- event logging -------------------------------------------------------------------------

const { shouldBlockRequestUrl } = new Function(
  blankSyntax(read("mods/features/telemetry/endpoints.js")) + "\nreturn { shouldBlockRequestUrl };",
)();
const LOG = "https://www.youtube.com/youtubei/v1/log_event?alt=json";
const WATCHTIME = "https://s.youtube.com/api/stats/watchtime?ver=2";

test("event logging is blocked only when its setting is on", () => {
  assert.equal(shouldBlockRequestUrl(LOG, { eventLogging: false }), false);
  assert.equal(shouldBlockRequestUrl(LOG, {}), false);
  assert.equal(shouldBlockRequestUrl(LOG, { eventLogging: true }), true);
});

test("event logging never blocks watch-history reports", () => {
  assert.equal(shouldBlockRequestUrl(WATCHTIME, { eventLogging: true, viewStats: false }), false);
  assert.equal(shouldBlockRequestUrl(WATCHTIME, { eventLogging: true, viewStats: true }), true);
});
