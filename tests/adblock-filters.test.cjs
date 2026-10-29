// Runs the real mods/features/adblock.js response filter against synthetic
// YouTube payloads. The filter is captured from the response pipeline stub.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function loadFilter(settings) {
  const captured = [];
  const identity = (items) => items;
  const ctx = vm.createContext({
    configRead: (k) => settings[k],
    timelyAction: () => ({}),
    ButtonRenderer: () => ({}),
    ShelfRenderer: () => ({}),
    TileRenderer: () => ({}),
    PatchSettings() {},
    t: (s) => s,
    deArrowify() {},
    hqify() {},
    addLongPress() {},
    addPreviews() {},
    hideVideo: identity,
    filterGuideItems: (r) => r,
    installResponsePipeline: (filters) => {
      captured.push(...filters);
    },
    window: { queuedVideos: { videos: [] }, sponsorblock: null, JSON },
    JSON,
    console,
  });
  let src = fs
    .readFileSync(path.join(ROOT, "mods/features/adblock.js"), "utf8")
    .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
  vm.runInContext(src, ctx, { filename: "adblock.js" });
  return captured[0];
}

const tile = (id) => ({ tileRenderer: { contentId: id } });

test("ad slots inside horizontal lists are removed on every response path, not only browse", () => {
  const filter = loadFilter({ enableAdBlock: true, enableShorts: true });
  const json = {
    contents: {
      sectionListRenderer: {
        contents: [
          {
            shelfRenderer: {
              content: { horizontalListRenderer: { items: [{ adSlotRenderer: {} }, tile("a")] } },
            },
          },
        ],
      },
    },
  };
  filter(json);
  const items =
    json.contents.sectionListRenderer.contents[0].shelfRenderer.content.horizontalListRenderer
      .items;
  assert.deepEqual(
    items.map((i) => Object.keys(i)[0]),
    ["tileRenderer"],
    "search-style ad slot removed",
  );
});

test("premium upsell shelves (hideLogo) and promo shelves are removed", () => {
  const filter = loadFilter({ enableAdBlock: true, enableShorts: true });
  const json = {
    contents: {
      sectionListRenderer: {
        contents: [
          {
            shelfRenderer: {
              tvhtml5Metadata: { hideLogo: true },
              content: { horizontalListRenderer: { items: [tile("u")] } },
            },
          },
          { promoShelfRenderer: {} },
          { shelfRenderer: { content: { horizontalListRenderer: { items: [tile("keep")] } } } },
        ],
      },
    },
  };
  filter(json);
  const shelves = json.contents.sectionListRenderer.contents;
  assert.equal(shelves.length, 1, `remaining shelves: ${shelves.length}`);
  assert.ok(shelves[0].shelfRenderer, "the normal shelf survives");
});

test("with ad blocking off, ad slots and upsell shelves are kept", () => {
  const filter = loadFilter({ enableAdBlock: false, enableShorts: true });
  const json = {
    contents: {
      sectionListRenderer: {
        contents: [
          {
            shelfRenderer: {
              tvhtml5Metadata: { hideLogo: true },
              content: { horizontalListRenderer: { items: [{ adSlotRenderer: {} }] } },
            },
          },
        ],
      },
    },
  };
  filter(json);
  const shelf = json.contents.sectionListRenderer.contents[0].shelfRenderer;
  assert.equal(shelf.content.horizontalListRenderer.items.length, 1);
});
