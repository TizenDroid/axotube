"use strict";
// Everything that ships must run on the TV's engines: the service on Node 4, the
// splash and the TV page on Chromium 47 (the Tizen 4 baseline), and the phone config
// page on any browser that loads it. This gate parses every shipped file as ES5,
// including the inline scripts of the pages, checks that the generated pages are
// up to date, and checks the browser-side source against built-ins those engines
// lack. Run `npm run build` first, so the built artifacts exist.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const acorn = require(path.join(ROOT, "mods", "node_modules", "acorn"));
const pages = require(path.join(ROOT, "scripts", "build-web-pages.cjs"));

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

// Files the service runs as written, and the built files it and the TV load.
const SERVICE_SOURCES = [
  "service/loader.js",
  "service/serviceUpdater.cjs",
  "service/bundleUpdates.cjs",
  "service/proxy.js",
  "service/standalone.js",
  "service/service.js",
  "service/diagnostics.js",
  "service/launchSettings.js",
  "service/webConfigPage.js",
  "service/diagnosticsPage.js",
  "shared/configPolicy.js",
  "service/cdp/websocket.js",
  "service/cdp/sdb.js",
  "service/cdp/cdp.js",
  "service/cdp/launcher.js",
];

const BUILT_FILES = [
  "standalone/service/dist/index.js",
  "standalone/service/dist/core.js",
  "dist/early.js",
  "dist/userScript.js",
  "dist/service.js",
  "standalone/userscript/early.js",
  "standalone/userscript/userScript.js",
];

// Pages with inline scripts: the splash the TV opens first, and the two web pages.
const PAGE_FILES = [
  "standalone/index.html",
  "service/web/config.html",
  "service/web/diagnostics.html",
];

function inlineScripts(html) {
  const out = [];
  const re = /<script>([\s\S]*?)<\/script>/g;
  let match;
  while ((match = re.exec(html))) out.push(match[1]);
  return out;
}

function assertEs5(source, label) {
  assert.doesNotThrow(() => acorn.parse(source, { ecmaVersion: 5 }), label + " must parse as ES5");
}

for (const file of SERVICE_SOURCES) {
  test(file + " is ES5 as written", () => assertEs5(read(file), file));
}

for (const file of BUILT_FILES) {
  test(file + " (built) is ES5", () => {
    assert.ok(fs.existsSync(path.join(ROOT, file)), file + " is missing; run npm run build");
    assertEs5(read(file), file);
  });
}

for (const file of PAGE_FILES) {
  test(file + " inline scripts are ES5", () => {
    const scripts = inlineScripts(read(file));
    assert.ok(scripts.length > 0, file + " has an inline script");
    scripts.forEach((script, i) => assertEs5(script, file + " script " + i));
  });
}

for (const page of pages.PAGES) {
  test(page.out + " is generated from " + page.source + " and is up to date", () => {
    assert.equal(read(page.out), pages.render(page), "run node scripts/build-web-pages.cjs");
  });
}

// Built-ins missing from Chromium 47 (the Tizen 4 baseline). Syntax is covered
// above; these are the runtime calls ES5 code is still tempted to use.
const BROWSER_FORBIDDEN = [
  [/\.includes\s*\(/, "Array/String.prototype.includes (ES2016)"],
  [/\.padStart\s*\(|\.padEnd\s*\(/, "padStart/padEnd (ES2017)"],
  [/Object\.(entries|values)\s*\(/, "Object.entries/values (ES2017)"],
  [/Number\.(isFinite|isInteger|isNaN|isSafeInteger)\s*\(/, "Number.isFinite and friends (ES2015)"],
  [/Array\.from\s*\(/, "Array.from (ES2015)"],
  [/new URLSearchParams\s*\(/, "URLSearchParams (Chrome 49)"],
];

function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'\\])\/\/.*$/gm, "$1");
}

const BROWSER_SOURCES = PAGE_FILES.concat([
  "mods/features/playbackRecovery.js",
  "mods/features/standaloneDiagnostics.js",
  "mods/features/updater.js",
]);

for (const file of BROWSER_SOURCES) {
  test(file + " uses no built-in newer than Chromium 47", () => {
    const src = codeOnly(read(file));
    for (const [pattern, name] of BROWSER_FORBIDDEN) {
      assert.ok(!pattern.test(src), file + " uses " + name);
    }
  });
}
