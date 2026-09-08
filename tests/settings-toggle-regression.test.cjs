const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'mods/ui/ui.js'), 'utf8');

function between(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

test('direct remote settings opener patches command resolver before rendering', () => {
  const settingsBranch = between(
    src,
    'if (evt.keyCode == 404 && evt.type === "keydown") {',
    '} else if (evt.keyCode == 39',
  );

  const patchIndex = settingsBranch.indexOf('patchResolveCommand()');
  const openIndex = settingsBranch.indexOf('modernUI()');

  assert.notEqual(
    patchIndex,
    -1,
    'settings can render while their setClientSettingEndpoint commands still target an unpatched resolver',
  );
  assert.notEqual(openIndex, -1, 'settings opener no longer renders modernUI');
  assert.ok(
    patchIndex < openIndex,
    'the resolver must be patched before the settings modal is dispatched',
  );
});
