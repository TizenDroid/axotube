"use strict";
// Two service fixes:
// - a cors-bypass target that already carries this proxy's prefix (including the
//   malformed "http//localhost:..." form) resolves to the real host, and the text
//   rewriter never stacks the prefix twice;
// - the launch mode file is one shared file, not one per running core copy.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

function loadFn(file, startMarker, endMarker, extra) {
  const code = read(file);
  const start = code.indexOf(startMarker);
  assert.ok(start >= 0, startMarker + " exists");
  const end = code.indexOf(endMarker, start) + endMarker.length;
  return code.slice(start, end);
}

function loadParseCorsTarget() {
  const code = read("service/proxy.js");
  const urlStart = code.indexOf("var URL = require('url');");
  const body = [
    "var net = require(\"net\");",
    code.slice(urlStart, urlStart + "var URL = require('url');".length),
    loadFn("service/proxy.js", "var EXACT_CORS_HOSTS", "};", ""),
    loadFn("service/proxy.js", "function isPrivateHostname", "\n}\n", "\n"),
    loadFn("service/proxy.js", "function isAllowedCorsTarget", "\n}\n", "\n"),
    loadFn("service/proxy.js", "function parseCorsTarget", "\n}\n", "\n"),
    "return parseCorsTarget;",
  ].join("\n");
  return new Function("require", body)(require);
}

test("the malformed https://http// prefix resolves to the real host", () => {
  const parse = loadParseCorsTarget();
  const bad = "https://http//localhost:8081/cors-bypass/https://www.gstatic.com/youtube/img/x.png";
  const parsed = parse(bad);
  assert.ok(parsed, "allowed");
  assert.equal(parsed.hostname, "www.gstatic.com");
  assert.equal(parsed.pathname, "/youtube/img/x.png");
});

test("a doubly prefixed target resolves to the real host", () => {
  const parse = loadParseCorsTarget();
  const p = "http://localhost:8081/cors-bypass/";
  const parsed = parse(p + p + "https://www.gstatic.com/a");
  assert.equal(parsed.hostname, "www.gstatic.com");
});

test("an ordinary target is unchanged, and a disallowed host is still refused", () => {
  const parse = loadParseCorsTarget();
  assert.equal(parse("https://www.gstatic.com/a").hostname, "www.gstatic.com");
  assert.equal(parse("https://example.com/a"), null);
  assert.equal(parse("http://localhost:8081/cors-bypass/https://example.com/a"), null);
});

test("rewriting already-rewritten text does not stack the prefix", () => {
  const code = read("service/proxy.js");
  const start = code.indexOf("function rewriteTrustedText(text)");
  const end = code.indexOf("\n}\n", start) + 3;
  const rewrite = new Function("PORT", code.slice(start, end) + "\nreturn rewriteTrustedText;")(8081);
  const once = rewrite('var a="https://www.gstatic.com/x.png";');
  const twice = rewrite(once);
  assert.equal(twice, once);
  assert.ok(!twice.includes("cors-bypass/http://localhost:8081/cors-bypass/"), twice);
});

test("the launch mode file is in the loader's shared folder, not the running copy's folder", () => {
  const shared = fs.mkdtempSync(path.join(os.tmpdir(), "axo-shared-"));
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "axo-copy-"));
  const modPath = require.resolve(path.join(ROOT, "service/launchSettings.js"));
  delete require.cache[modPath];
  global.axotubeDataDir = shared;
  try {
    const settings = require(modPath);
    assert.equal(path.dirname(settings.filePath()), shared);
    settings.setDebugger(true);
    assert.ok(fs.existsSync(path.join(shared, "axotube-launch.json")));
    assert.equal(settings.read().debugger, true);
  } finally {
    delete global.axotubeDataDir;
    delete require.cache[modPath];
    fs.rmSync(shared, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test("the loader publishes the shared folder before it starts any core", () => {
  const loader = read("service/loader.js");
  const set = loader.indexOf("global.axotubeDataDir = SHIPPED_DIR;");
  assert.ok(set >= 0, "shared folder is set");
  assert.ok(set < loader.indexOf("require(choice.file)"), "set before the core is required");
});
