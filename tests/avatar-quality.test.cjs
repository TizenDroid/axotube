"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const src = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/avatarQuality.js"), "utf8"));
const { filterAvatarQuality, AVATAR_TARGET_PX } = new Function(src + "\nreturn { filterAvatarQuality, AVATAR_TARGET_PX };")();

const GOOGLE = "https://yt3.ggpht.com/abc123=s88-c-k-c0x00ffffff-no-rj";
const LH3 = "https://lh3.googleusercontent.com/xyz=s48-c-k-c0x00ffffff-no-rj";

test("the target is 176px", () => {
  assert.equal(AVATAR_TARGET_PX, 176);
});

test("a small channel avatar is asked for at 176px, and its declared size follows", () => {
  const result = { thumbnails: [{ url: GOOGLE, width: 88, height: 88 }] };
  filterAvatarQuality(result, JSON.stringify(result));
  assert.equal(result.thumbnails[0].url, "https://yt3.ggpht.com/abc123=s176-c-k-c0x00ffffff-no-rj");
  assert.equal(result.thumbnails[0].width, 176);
  assert.equal(result.thumbnails[0].height, 176);
});

test("profile avatars on the other Google host are upgraded the same way", () => {
  const result = { account: { avatar: { thumbnails: [{ url: LH3, width: 48, height: 48 }] } } };
  filterAvatarQuality(result, JSON.stringify(result));
  assert.equal(result.account.avatar.thumbnails[0].url, "https://lh3.googleusercontent.com/xyz=s176-c-k-c0x00ffffff-no-rj");
});

test("an avatar already at 176px or larger is never made smaller", () => {
  const big = "https://yt3.ggpht.com/abc=s300-c-k";
  const result = { thumbnails: [{ url: big, width: 300, height: 300 }] };
  filterAvatarQuality(result, JSON.stringify(result));
  assert.equal(result.thumbnails[0].url, big);
  assert.equal(result.thumbnails[0].width, 300);
});

test("video thumbnails and banners are not touched", () => {
  const video = "https://i.ytimg.com/vi/abc/hqdefault.jpg";
  const banner = "https://yt3.ggpht.com/banner=w1060-fcrop64=1,00005a57ffffa5a8";
  const result = { thumbnails: [{ url: video, width: 480 }, { url: banner, width: 1060 }] };
  filterAvatarQuality(result, JSON.stringify(result));
  assert.equal(result.thumbnails[0].url, video);
  assert.equal(result.thumbnails[1].url, banner);
});

test("a response with no avatar host is not walked at all", () => {
  let touched = false;
  const result = {};
  Object.defineProperty(result, "probe", { enumerable: true, get() { touched = true; return {}; } });
  filterAvatarQuality(result, '{"plain":"no avatar hosts here"}');
  assert.equal(touched, false);
});
