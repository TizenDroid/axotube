const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateConfigValue } = require('../shared/configPolicy.js');

test('browser and Node adapters use the same validation policy', () => {
  const root = path.resolve(__dirname, '..');
  const browser = fs.readFileSync(path.join(root, 'mods/config.js'), 'utf8');
  const server = fs.readFileSync(path.join(root, 'service/service.js'), 'utf8');
  assert.match(browser, /import configPolicy from "\.\.\/shared\/configPolicy\.js"/);
  assert.match(browser, /export const validateConfigValue = configPolicy\.validateConfigValue/);
  assert.match(server, /require\("\.\.\/shared\/configPolicy\.js"\)/);
});

test('numeric limits reject invalid values without changing feature defaults', () => {
  assert.equal(validateConfigValue('videoSpeed', 0.05), true);
  assert.equal(validateConfigValue('videoSpeed', 5), true);
  assert.equal(validateConfigValue('videoSpeed', 0.01), false);
  assert.equal(validateConfigValue('videoSpeed', 5.01), false);
  assert.equal(validateConfigValue('videoSpeed', NaN), false);
  assert.equal(validateConfigValue('videoSpeed', Infinity), false);
  assert.equal(validateConfigValue('autoFrameRate', false), true);
  assert.equal(validateConfigValue('autoFrameRate', 'false'), false);
});

test('enum, array and URL policies apply identically to both runtimes', () => {
  assert.equal(validateConfigValue('videoPreferredCodec', 'av01'), true);
  assert.equal(validateConfigValue('videoPreferredCodec', 'malformed'), false);
  assert.equal(validateConfigValue('disabledSidebarContents', ['EXPLORE', 'HOME']), true);
  assert.equal(validateConfigValue('disabledSidebarContents', ['HOME', 42]), false);
  assert.equal(validateConfigValue('routeColor', '#aBc123'), true);
  assert.equal(validateConfigValue('routeColor', 'red; background:red'), false);
  assert.equal(validateConfigValue('routeBackgroundUrl', 'https://example.com/image.png'), true);
  assert.equal(validateConfigValue('routeBackgroundUrl', 'javascript:alert(1)'), false);
  assert.equal(validateConfigValue('routeBackgroundUrl', 'file:///etc/passwd'), false);
});

test('launch command representation and unknown keys remain guarded', () => {
  assert.equal(validateConfigValue('launchToOnStartup', null), true);
  assert.equal(validateConfigValue('launchToOnStartup', '{"watchEndpoint":{"videoId":"x"}}'), true);
  assert.equal(validateConfigValue('launchToOnStartup', { watchEndpoint: {} }), false);
  assert.equal(validateConfigValue('__proto__', {}), false);
  assert.equal(validateConfigValue('unknownSetting', true), false);
});
