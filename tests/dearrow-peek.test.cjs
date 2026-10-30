// The long-press peek shows the other version: DeArrow when DeArrow is off for
// that field, the original when it is on. Runs the real deArrowPeek.js.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const ORIGINAL_THUMBS = [{ url: "original.jpg", width: 480, height: 360 }];
const DEARROW_THUMBS = [{ url: "dearrow.jpg", width: 1280, height: 640 }];
const DATA = { titles: [{ title: "Clear title", votes: 3 }], thumbnails: [] };

function run({ titles, thumbs, peek = true }) {
  const source = fs
    .readFileSync(path.join(ROOT, "mods/features/deArrowPeek.js"), "utf8")
    .replace(/^import\s+[\s\S]*?;\s*$/gm, "")
    .replace(/^export\s+/gm, "");
  const ctx = vm.createContext({
    configRead: (key) =>
      ({
        enableDeArrowPeek: peek,
        enableDeArrowTitles: titles,
        enableDeArrowThumbnails: thumbs,
      })[key],
    deArrowTitleFor: () => "Clear title",
    deArrowThumbnailsFor: () => DEARROW_THUMBS,
    getDeArrowData: () => DATA,
    getOriginalTile: () => ({ title: "Original clickbait", thumbnails: ORIGINAL_THUMBS }),
  });
  vm.runInContext(source + "\n;globalThis.applyDeArrowPeek = applyDeArrowPeek;", ctx);
  const cmd = {
    showMenuCommand: {
      contentId: "vid",
      title: { simpleText: "shown now" },
      thumbnail: { thumbnails: [] },
    },
  };
  ctx.applyDeArrowPeek(cmd);
  return cmd.showMenuCommand;
}

test("DeArrow on: the peek shows the original title and thumbnail", () => {
  const m = run({ titles: true, thumbs: true });
  assert.equal(m.title.simpleText, "Original clickbait");
  assert.equal(JSON.stringify(m.thumbnail.thumbnails), JSON.stringify(ORIGINAL_THUMBS));
});

test("DeArrow off: the peek shows the DeArrow title and thumbnail", () => {
  const m = run({ titles: false, thumbs: false });
  assert.equal(m.title.simpleText, "Clear title");
  assert.equal(JSON.stringify(m.thumbnail.thumbnails), JSON.stringify(DEARROW_THUMBS));
});

test("each field is swapped on its own", () => {
  const m = run({ titles: true, thumbs: false });
  assert.equal(m.title.simpleText, "Original clickbait");
  assert.equal(JSON.stringify(m.thumbnail.thumbnails), JSON.stringify(DEARROW_THUMBS));
});

test("peek off: the menu is left alone", () => {
  const m = run({ titles: true, thumbs: true, peek: false });
  assert.equal(m.title.simpleText, "shown now");
});
