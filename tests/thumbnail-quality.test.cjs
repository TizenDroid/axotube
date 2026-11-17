"use strict";
// The preferred thumbnail size: which files a tile may use, the step-down when a file is
// missing, the page-level fallback, and the background warm-up. Runs the shipped module source.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// A stand-in Image: the handlers are set before src, and a missing file calls onerror.
// outcome(file) -> { error: true } | { width, height }.
function fakeImage(outcome) {
  const requests = [];
  class FakeImage {
    set src(url) {
      requests.push(url);
      const file = url.split("/").pop();
      const result = outcome(file);
      if (result.error) {
        if (this.onerror) this.onerror();
      } else {
        this.naturalWidth = result.width || 480;
        this.naturalHeight = result.height || 360;
        if (this.onload) this.onload.call(this);
      }
    }
  }
  return { FakeImage, requests };
}

function loadShared(FakeImage) {
  const cache = new Function(blankSyntax(read("mods/shared/boundedCache.js")) + "\nreturn createBoundedCache;")();
  return new Function(
    "createBoundedCache",
    blankSyntax(read("mods/shared/hqThumbnails.js")) +
      "\nreturn { THUMBNAIL_FILES, thumbnailChain, resolveThumbnailQuality, buildThumbnailArray," +
      " resolveThumbnailFile, fileOfThumbnailUrl, nextLowerFile, isPlaceholderImage, hqQualityCache," +
      " createPrefetcher, PREFETCH_CONCURRENCY, PREFETCH_MEMORY, DEFAULT_THUMBNAIL_QUALITY };",
  )(cache);
}

const everything = () => ({});
const missing = (...files) => (file) => (files.indexOf(file) !== -1 ? { error: true } : {});

test("the preference is one of the sizes; anything else falls back to the maximum", () => {
  const { FakeImage } = fakeImage(everything);
  const mod = loadShared(FakeImage);
  assert.equal(mod.resolveThumbnailQuality("max"), "max");
  assert.equal(mod.resolveThumbnailQuality("nonsense"), "max");
  assert.equal(mod.resolveThumbnailQuality(undefined), "max");
  assert.equal(mod.DEFAULT_THUMBNAIL_QUALITY, "max", "maximum is the default");
});

test("the sizes are listed largest first with true pixel sizes (no 1080p file exists)", () => {
  const mod = loadShared(fakeImage(everything).FakeImage);
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
  const mod = loadShared(fakeImage(everything).FakeImage);
  assert.deepEqual(mod.thumbnailChain("hq").map((e) => e.id), ["hq", "mq", "default"]);
  assert.deepEqual(mod.thumbnailChain("max").map((e) => e.id), ["max", "sd", "hq", "mq", "default"]);
  assert.deepEqual(mod.thumbnailChain("mq").map((e) => e.id), ["mq", "default"]);
});

test("the tile array lists the chain's URLs and sizes", () => {
  const mod = loadShared(fakeImage(everything).FakeImage);
  const arr = mod.buildThumbnailArray("abc123", "sd");
  assert.deepEqual(arr.map((t) => t.url), [
    "https://i.ytimg.com/vi/abc123/sddefault.jpg",
    "https://i.ytimg.com/vi/abc123/hqdefault.jpg",
    "https://i.ytimg.com/vi/abc123/mqdefault.jpg",
    "https://i.ytimg.com/vi/abc123/default.jpg",
  ]);
  assert.deepEqual([arr[0].width, arr[0].height], [640, 480]);
});

test("the step-down is one size at a time, and stops at the smallest", () => {
  const mod = loadShared(fakeImage(everything).FakeImage);
  assert.equal(mod.nextLowerFile("maxresdefault.jpg"), "sddefault.jpg");
  assert.equal(mod.nextLowerFile("sddefault.jpg"), "hqdefault.jpg");
  assert.equal(mod.nextLowerFile("hqdefault.jpg"), "mqdefault.jpg");
  assert.equal(mod.nextLowerFile("mqdefault.jpg"), "default.jpg");
  assert.equal(mod.nextLowerFile("default.jpg"), null);
});

test("a thumbnail URL names its file; any other URL names none", () => {
  const mod = loadShared(fakeImage(everything).FakeImage);
  assert.equal(mod.fileOfThumbnailUrl("https://i.ytimg.com/vi/abc/maxresdefault.jpg?sqp=x"), "maxresdefault.jpg");
  assert.equal(mod.fileOfThumbnailUrl("https://yt3.ggpht.com/abc=s88"), null);
});

test("a placeholder is a 120x90 image for any file except default.jpg", () => {
  const mod = loadShared(fakeImage(everything).FakeImage);
  assert.equal(mod.isPlaceholderImage(120, 90, "maxresdefault.jpg"), true);
  assert.equal(mod.isPlaceholderImage(120, 90, "default.jpg"), false);
  assert.equal(mod.isPlaceholderImage(1280, 720, "maxresdefault.jpg"), false);
});

test("HQ resolves with one image load: the same image the tile then shows", () => {
  const { FakeImage, requests } = fakeImage(everything);
  const mod = loadShared(FakeImage);
  let got = null;
  mod.resolveThumbnailFile("vid1", "hq", (file) => (got = file), FakeImage);
  assert.equal(got, "hqdefault.jpg");
  assert.deepEqual(requests, ["https://i.ytimg.com/vi/vid1/hqdefault.jpg"]);
});

test("Max loads maxresdefault and falls back to sddefault when it is missing", () => {
  const { FakeImage, requests } = fakeImage(missing("maxresdefault.jpg"));
  const mod = loadShared(FakeImage);
  let got = null;
  mod.resolveThumbnailFile("vid2", "max", (file) => (got = file), FakeImage);
  assert.equal(got, "sddefault.jpg");
  assert.deepEqual(requests, [
    "https://i.ytimg.com/vi/vid2/maxresdefault.jpg",
    "https://i.ytimg.com/vi/vid2/sddefault.jpg",
  ]);
});

test("YouTube's 120x90 placeholder for a missing maxres counts as missing", () => {
  const placeholder = (file) => (file === "maxresdefault.jpg" ? { width: 120, height: 90 } : {});
  const { FakeImage, requests } = fakeImage(placeholder);
  const mod = loadShared(FakeImage);
  let got = null;
  mod.resolveThumbnailFile("vid3", "max", (file) => (got = file), FakeImage);
  assert.equal(got, "sddefault.jpg");
  assert.equal(requests.length, 2);
});

test("when Max and SD are both missing, the step-down ends at HQ", () => {
  const { FakeImage, requests } = fakeImage(missing("maxresdefault.jpg", "sddefault.jpg"));
  const mod = loadShared(FakeImage);
  let got = null;
  mod.resolveThumbnailFile("vid4", "max", (file) => (got = file), FakeImage);
  assert.equal(got, "hqdefault.jpg");
  assert.equal(requests.length, 3);
});

test("a resolved file is remembered per preference and video: no second load", () => {
  const { FakeImage, requests } = fakeImage(everything);
  const mod = loadShared(FakeImage);
  mod.resolveThumbnailFile("vid5", "max", () => {}, FakeImage);
  const after = requests.length;
  mod.resolveThumbnailFile("vid5", "max", () => {}, FakeImage);
  assert.equal(requests.length, after, "second resolve comes from the cache");
  assert.equal(mod.hqQualityCache.get("max|vid5"), "maxresdefault.jpg");
});

test("the background warm-up requests at most two images at a time, and starts the next as one finishes", () => {
  const { FakeImage, requests } = fakeImage(() => ({ error: true }));
  const mod = loadShared(FakeImage);
  const p = mod.createPrefetcher(class extends FakeImage {
    set src(url) {
      requests.push(url);
      this.pending = true;
    }
  });
  p.enqueue(["a", "b", "c", "d"]);
  assert.deepEqual(requests, ["a", "b"]);
});

test("a warm-up URL is requested once while it is remembered", () => {
  const { FakeImage, requests } = fakeImage(() => ({ error: true }));
  const mod = loadShared(FakeImage);
  const p = mod.createPrefetcher(class extends FakeImage {
    set src(url) {
      requests.push(url);
    }
  });
  p.enqueue(["x"]);
  p.enqueue(["x", "x"]);
  assert.equal(requests.length, 1);
});

test("the focus upgrade resolves through the shared rule and swaps after the load, once focus rests", () => {
  const src = read("mods/features/hqThumbnailsFocusObserver.js");
  assert.ok(/resolveThumbnailFile\(videoId, preferred, applyFile, Image\)/.test(src), "resolves, no probe");
  assert.ok(!/probeBestThumbnailQuality/.test(src), "the probe is gone");
  assert.ok(/const FOCUS_SETTLE_MS = 150;/.test(src), "settle delay declared");
  assert.ok(/scheduleUpgrade\(element\);/.test(src), "class changes schedule, not upgrade");
  assert.ok(/focused !== target && !target\.contains\(focused\)/.test(src), "only the still-focused tile upgrades");
});
