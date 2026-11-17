"use strict";
// Page-level fallback: a tile's image that errors, or is the 120x90 placeholder for a missing
// size, steps down to the next file. Other images and the smallest file are left alone.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const src = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/thumbnailFallback.js"), "utf8"));
const shared = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/shared/hqThumbnails.js"), "utf8"));
const cache = new Function(blankSyntax(fs.readFileSync(path.join(ROOT, "mods/shared/boundedCache.js"), "utf8")) + "\nreturn createBoundedCache;")();
const { onThumbnailImageEvent, installThumbnailFallback } = new Function(
  "createBoundedCache",
  shared +
    "\n" +
    src +
    "\nreturn { onThumbnailImageEvent, installThumbnailFallback };",
)(cache);

const img = (src, extra) => Object.assign({ tagName: "IMG", getAttribute: (n) => (n === "src" ? src : null), setAttribute(n, v) { if (n === "src") this.src = v; } }, extra || {});

test("a maxres that errors steps down to sd, from the same video", () => {
  const el = img("https://i.ytimg.com/vi/abc/maxresdefault.jpg?sqp=x");
  assert.equal(onThumbnailImageEvent({ type: "error", target: el }), true);
  assert.equal(el.src, "https://i.ytimg.com/vi/abc/sddefault.jpg");
});

test("a 120x90 placeholder for a missing maxres steps down the same way", () => {
  const el = img("https://i.ytimg.com/vi/abc/maxresdefault.jpg", { naturalWidth: 120, naturalHeight: 90 });
  assert.equal(onThumbnailImageEvent({ type: "load", target: el }), true);
  assert.equal(el.src, "https://i.ytimg.com/vi/abc/sddefault.jpg");
});

test("a normal load is left alone, and so is an image that is not a thumbnail", () => {
  const ok = img("https://i.ytimg.com/vi/abc/sddefault.jpg", { naturalWidth: 640, naturalHeight: 480 });
  assert.equal(onThumbnailImageEvent({ type: "load", target: ok }), false);
  assert.equal(ok.src, undefined);
  const avatar = img("https://yt3.ggpht.com/abc=s88", {});
  assert.equal(onThumbnailImageEvent({ type: "error", target: avatar }), false);
});

test("the smallest file has nowhere to step down to", () => {
  const el = img("https://i.ytimg.com/vi/abc/default.jpg");
  assert.equal(onThumbnailImageEvent({ type: "error", target: el }), false);
});

test("the default.jpg placeholder size is not treated as missing", () => {
  const el = img("https://i.ytimg.com/vi/abc/default.jpg", { naturalWidth: 120, naturalHeight: 90 });
  assert.equal(onThumbnailImageEvent({ type: "load", target: el }), false);
});

test("the fallback listens in the capture phase for errors and loads, which do not bubble", () => {
  const seen = [];
  const doc = { addEventListener: (type, fn, capture) => seen.push([type, capture, fn]) };
  assert.equal(installThumbnailFallback(doc), true);
  assert.deepEqual(seen.map((s) => [s[0], s[1]]), [["error", true], ["load", true]]);
  assert.equal(installThumbnailFallback(null), false);
});
