const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

// Evaluate the real long-press module with its imports removed and its
// dependencies stubbed. Output is compared as JSON because the module runs in
// its own VM realm.
function loadLongPress() {
  const source = fs.readFileSync(path.join(ROOT, 'mods/features/longPressMenu.js'), 'utf8')
    .replace(/^import\s+[\s\S]*?;\s*$/gm, '')
    .replace(/^export\s+/gm, '');
  const ctx = vm.createContext({
    configRead: (key) => key === 'enableLongPress',
    cloneJSON: (value) => JSON.parse(JSON.stringify(value)),
    longPressData: (data) => ({ longPress: data }),
    queueMenuItem: (payload) => ({ menuServiceItemRenderer: { text: { runs: [{ text: 'Add to Queue' }] }, serviceEndpoint: { playlistEditEndpoint: { customAction: { action: 'ADD_TO_QUEUE', parameters: payload } } } } }),
  });
  vm.runInContext(source + '\n;globalThis.addLongPress = addLongPress;', ctx);
  return ctx.addLongPress;
}

function tile(overrides = {}) {
  const base = {
    tileRenderer: {
      style: 'TILE_STYLE_YTLR_DEFAULT',
      contentId: 'vid1',
      contentType: 'VIDEO',
      onSelectCommand: { watchEndpoint: { videoId: 'vid1' } },
      header: { tileHeaderRenderer: { thumbnail: { thumbnails: [{ url: 'a', width: 100 }] } } },
      metadata: {
        tileMetadataRenderer: {
          title: { simpleText: 'Title' },
          lines: [{ lineRenderer: { items: [{ lineItemRenderer: { text: { runs: [{ text: 'Channel' }] } } }] } }],
        },
      },
    },
  };
  return Object.assign(base, overrides);
}

test('tiles with title, thumbnail and subtitle get a long-press payload', () => {
  const addLongPress = loadLongPress();
  const items = [tile()];
  addLongPress(items);
  const payload = items[0].tileRenderer.onLongPressCommand.longPress;
  assert.equal(payload.videoId, 'vid1');
  assert.equal(payload.title, 'Title');
  assert.equal(payload.subtitle, 'Channel');
  assert.deepEqual(payload.thumbnails, [{ url: 'a', width: 100 }]);
});

test('payload is a copy, not a reference into the response tree', () => {
  const addLongPress = loadLongPress();
  const items = [tile()];
  addLongPress(items);
  const payload = items[0].tileRenderer.onLongPressCommand.longPress;
  assert.notEqual(payload.item.tileRenderer.metadata, items[0].tileRenderer.metadata);
});

test('tiles missing metadata, thumbnail, subtitle or watch endpoint are left unchanged', () => {
  const addLongPress = loadLongPress();
  const noSubtitle = tile();
  noSubtitle.tileRenderer.metadata.tileMetadataRenderer.lines = [];
  const noMetadata = tile();
  delete noMetadata.tileRenderer.metadata;
  const noThumbnail = tile();
  delete noThumbnail.tileRenderer.header;
  const noWatch = tile();
  delete noWatch.tileRenderer.onSelectCommand.watchEndpoint;
  const items = [noSubtitle, noMetadata, noThumbnail, noWatch];
  const before = JSON.stringify(items);
  addLongPress(items);
  assert.equal(JSON.stringify(items), before);
});

test('an existing long-press menu gets one Add to Queue entry, never a duplicate', () => {
  const addLongPress = loadLongPress();
  const withMenu = tile();
  withMenu.tileRenderer.onLongPressCommand = {
    showMenuCommand: { menu: { menuRenderer: { items: [] } } },
  };
  const items = [withMenu];
  addLongPress(items);
  addLongPress(items);
  const menu = items[0].tileRenderer.onLongPressCommand.showMenuCommand.menu.menuRenderer.items;
  assert.equal(menu.length, 1);
  assert.equal(menu[0].menuServiceItemRenderer.text.runs[0].text, 'Add to Queue');
});
