"use strict";
// The preferred thumbnail size: which files a tile may use, when a file must be checked,
// and that a check is cached per preference and video. Runs the shipped module source.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function loadShared() {
  const cache = new Function(
    blankSyntax(read("mods/shared/boundedCache.js")) + "\nreturn createBoundedCache;",
  )();
  const exportsOf = blankSyntax(read("mods/shared/hqThumbnails.js"));
  // Each test gets its own Image stub and caches, so nothing carries over.
  return (imageOutcome) => {
    const requests = [];
    class FakeImage {
      set src(url) {
        requests.push(url);
        const file = url.split("/").pop();
        const outcome = imageOutcome(file);
        if (outcome.error) this.onerror && this.onerror();
        else {
          this.naturalWidth = outcome.width || 480;
          this.naturalHeight = outcome.height || 360;
          this.onload && this.onload.call(this);
        }
      }
    }
    const mod = new Function(
      "createBoundedCache",
      "Image",
      exportsOf +
        "\nreturn { THUMBNAIL_FILES, thumbnailChain, resolveThumbnailQuality, buildThumbnailArray, probeBestThumbnailQuality, hqQualityCache };",
    )(cache, FakeImage);
    return { mod, requests };
  };
}

const load = loadShared();
const everything = () => ({});
const missing = (...files) => (file) => (files.indexOf(file) !== -1 ? { error: true } : {});

test("the preference is one of the sizes; anything else falls back to HQ", () => {
  const { mod } = load(everything);
  assert.equal(mod.resolveThumbnailQuality("max"), "max");
  assert.equal(mod.resolveThumbnailQuality("nonsense"), "hq");
  assert.equal(mod.resolveThumbnailQuality(undefined), "hq");
});

test("the sizes are listed largest first with true pixel sizes (no 1080p file exists)", () => {
  const { mod } = load(everything);
  assert.deepEqual(
    mod.THUMBNAIL_FILES.map((e) => [e.id, e.width, e.height]),
    [
      ["max", 1280, 720],
      ["sd", 640, 480],
      ["hq", 480, 360],
      ["mq", 320, 180],
      ["default", 120, 90],
    ],
  );
});

test("a tile gets the preferred size and smaller ones, never a larger one", () => {
  const { mod } = load(everything);
  assert.deepEqual(mod.thumbnailChain("hq").map((e) => e.id), ["hq", "mq", "default"]);
  assert.deepEqual(mod.thumbnailChain("max").map((e) => e.id), ["max", "sd", "hq", "mq", "default"]);
  assert.deepEqual(mod.thumbnailChain("mq").map((e) => e.id), ["mq", "default"]);
  const widths = mod.thumbnailChain("sd").map((e) => e.width);
  assert.ok(widths.every((w) => w <= 640), JSON.stringify(widths));
});

test("the tile array lists the chain's URLs and sizes", () => {
  const { mod } = load(everything);
  const arr = mod.buildThumbnailArray("abc123", "sd");
  assert.deepEqual(arr.map((t) => t.url), [
    "https://i.ytimg.com/vi/abc123/sddefault.jpg",
    "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
    "https://i.ytimg.com/vi/abc123/default.jpg",
  ]);
  assert.deepEqual([arr[0].width, arr[0].height], [640, 480]);
});

test("HQ is the default and needs no request: the file always exists", () => {
  const { mod, requests } = load(everything);
  let got = null;
  mod.probeBestThumbnailQuality("vid1", "hq", (file) => (got = file));
  assert.equal(got, "hqdefault.jpg", "answer is immediate");
  assert.deepEqual(requests, [], "no image is requested for HQ");
});

test("Max checks maxresdefault, then falls back to sddefault when it is missing", () => {
  const { mod, requests } = load(missing("maxresdefault.jpg"));
  let got = null;
  mod.probeBestThumbnailQuality("vid2", "max", (file) => (got = file));
  assert.equal(got, "sddefault.jpg");
  assert.deepEqual(requests, [
    "https://i.ytimg.com/vi/vid2/maxresdefault.jpg",
    "https://i.ytimg.com/vi/vid2/sddefault.jpg",
  ]);
});

test("the 120x90 placeholder YouTube returns for a missing file counts as missing", () => {
  const placeholder = (file) =>
    file === "maxresdefault.jpg" ? { width: 120, height: 90 } : {};
  const { mod, requests } = load(placeholder);
  let got = null;
  mod.probeBestThumbnailQuality("vid3", "max", (file) => (got = file));
  assert.equal(got, "sddefault.jpg");
  assert.equal(requests.length, 2);
});

test("when Max and SD are both missing, the walk stops at HQ, which is never checked", () => {
  const { mod, requests } = load(missing("maxresdefault.jpg", "sddefault.jpg"));
  let got = null;
  mod.probeBestThumbnailQuality("vid4", "max", (file) => (got = file));
  assert.equal(got, "hqdefault.jpg");
  assert.equal(requests.length, 2, "maxres and sd were checked; hq was not");
});

test("a check is cached per preference and video, so the same tile is not checked again", () => {
  const { mod, requests } = load(everything);
  mod.probeBestThumbnailQuality("vid5", "max", () => {});
  const after = requests.length;
  mod.probeBestThumbnailQuality("vid5", "max", () => {});
  assert.equal(requests.length, after, "second answer comes from the cache");
  assert.equal(mod.hqQualityCache.get("max|vid5"), "maxresdefault.jpg");
  // A different preference is a different answer, even for the same video.
  mod.probeBestThumbnailQuality("vid5", "sd", () => {});
  assert.equal(mod.hqQualityCache.get("sd|vid5"), "sddefault.jpg");
});

// The focus observer's structure is checked against its source: it must not watch inline
// styles (which leanback changes on every focus animation frame), and a better image must
// be loaded before it replaces the one on screen.
test("the focus observer watches class and image sources only, and preloads before a swap", () => {
  const src = read("mods/features/hqThumbnailsFocusObserver.js");
  const filter = /attributeFilter:\s*\[([^\]]*)\]/.exec(src);
  assert.ok(filter, "attributeFilter present");
  assert.ok(!/"style"/.test(filter[1]), "style is not watched: " + filter[1]);
  assert.ok(/const preload = new Image\(\)/.test(src), "preloads the new image");
  assert.ok(src.indexOf("preload.onload") < src.indexOf("element.src = finalUrl"), "swap happens in onload");
});

// The background warm-up: bounded, two at a time, each URL requested once.
function loadPrefetcher() {
  const src = blankSyntax(read("mods/shared/hqThumbnails.js"));
  const cache = new Function(blankSyntax(read("mods/shared/boundedCache.js")) + "\nreturn createBoundedCache;")();
  const requests = [];
  class FakeImage {
    set src(url) {
      requests.push({ url, img: this });
    }
  }
  const mod = new Function("createBoundedCache", src + "\nreturn { createPrefetcher, PREFETCH_CONCURRENCY, PREFETCH_MEMORY };")(cache);
  return { mod, requests, FakeImage };
}

test("the warm-up requests at most two images at a time, and starts the next as one finishes", () => {
  const { mod, requests, FakeImage } = loadPrefetcher();
  const p = mod.createPrefetcher(FakeImage);
  p.enqueue(["a", "b", "c", "d"]);
  assert.deepEqual(requests.map((r) => r.url), ["a", "b"]);
  requests[0].img.onload();
  assert.deepEqual(requests.map((r) => r.url), ["a", "b", "c"]);
  requests[1].img.onerror();
  assert.deepEqual(requests.map((r) => r.url), ["a", "b", "c", "d"]);
});

test("a URL is requested once while it is remembered, and not again when it comes back", () => {
  const { mod, requests, FakeImage } = loadPrefetcher();
  const p = mod.createPrefetcher(FakeImage);
  p.enqueue(["x"]);
  p.enqueue(["x", "x"]);
  assert.equal(requests.length, 1);
});

test("the waiting queue and the memory are both bounded", () => {
  const { mod, requests, FakeImage } = loadPrefetcher();
  const p = mod.createPrefetcher(FakeImage);
  const many = [];
  for (let i = 0; i < 500; i++) many.push("u" + i);
  p.enqueue(many);
  // Two running, at most PREFETCH_QUEUE_MAX waiting.
  assert.ok(p.pending() <= 2 + 120, String(p.pending()));
  // Finish everything: no more than the memory is ever requested.
  for (let guard = 0; guard < 10000 && requests.some((r) => !r.done); guard++) {
    const next = requests.find((r) => !r.done);
    next.done = true;
    next.img.onload();
  }
  assert.ok(requests.length <= 500);
});

test("the focus upgrade waits for focus to rest, so a tile passed on the way is not swapped", () => {
  const src = read("mods/features/hqThumbnailsFocusObserver.js");
  assert.ok(/const FOCUS_SETTLE_MS = 150;/.test(src), "settle delay declared");
  assert.ok(/scheduleUpgrade\(element\);/.test(src), "class changes schedule, not upgrade");
  assert.ok(/clearTimeout\(settleTimer\)/.test(src), "a new focus cancels the pending upgrade");
  assert.ok(/focused !== target && !target\.contains\(focused\)/.test(src), "only the still-focused tile upgrades");
});
