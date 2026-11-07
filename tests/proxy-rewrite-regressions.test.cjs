// Regression checks for the standalone rewrite and early-bundle fixes:
// - the redirector host is prefixed once, not twice;
// - an euri value that contains an argument list is left alone instead of being
//   cut at its inner comma (which produced invalid JavaScript);
// - the early bundle loads the polyfills before config.js needs EventTarget;
// - WGT toasts and phone commands are gated on the Tizen web API too.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// Load rewriteTrustedText from the real proxy source, so the test exercises the
// code that ships rather than a copy of it.
function loadRewriteTrustedText() {
  // Normalize line endings: a Windows checkout gives CRLF, and the function
  // boundary below is found by searching for "\n}\n".
  const code = read("service/proxy.js").replace(/\r\n/g, "\n");
  const start = code.indexOf("function rewriteTrustedText(text)");
  assert.ok(start >= 0, "rewriteTrustedText exists");
  const end = code.indexOf("\n}\n", start) + 3;
  return new Function("PORT", code.slice(start, end) + "\nreturn rewriteTrustedText;")(8081);
}

test("the redirector host is prefixed exactly once", () => {
  const rewrite = loadRewriteTrustedText();
  const prefix = "http://localhost:8081/cors-bypass/https://redirector.googlevideo.com";
  const out = rewrite('a="https://redirector.googlevideo.com/initplayback?x=1";');
  assert.ok(out.includes('"' + prefix + '/initplayback?x=1"'), out);
  assert.ok(!out.includes("https://http://"), "no doubled scheme");
  assert.equal(out.split("/cors-bypass/").length - 1, 1, "one cors-bypass prefix");
});

test("a bare redirector hostname is still prefixed", () => {
  const rewrite = loadRewriteTrustedText();
  const out = rewrite('a="redirector.googlevideo.com/x";');
  assert.ok(out.includes("http://localhost:8081/cors-bypass/https://redirector.googlevideo.com/x"), out);
});

test("euri values with an argument list are not cut into invalid JavaScript", () => {
  const rewrite = loadRewriteTrustedText();
  const input = "{euri:f(x,y),c:1}";
  const out = rewrite(input);
  assert.equal(out, input, "left unchanged");
  assert.doesNotThrow(() => new Function("return " + out));
});

test("a simple euri value is still rewritten to the youtube.com origin, and stays valid", () => {
  const rewrite = loadRewriteTrustedText();
  const out = rewrite("{euri:a.b,c:1}");
  assert.ok(out.includes('euri:document.location.toString().replace("http://localhost:8081", "https://www.youtube.com"),c:1'), out);
  assert.doesNotThrow(() => new Function("return " + out));
});

test("the Java proxy uses the same euri rule as the Node proxy", () => {
  const java = read("android/app/src/main/java/org/axotube/tv/LocalProxy.java");
  assert.ok(java.includes('"euri:(?:[^,(){}]+|[\\\\w$.]+\\\\(\\\\)),"'), "Java euri pattern matches proxy.js");
  assert.ok(!java.includes('"euri:[^,]+,"'), "old unanchored pattern removed");
});

test("early.js imports the polyfills before the modules that use EventTarget", () => {
  const early = read("mods/early.js");
  const polyfill = early.indexOf('import "./polyfills.js"');
  const config = early.indexOf("experimentalResolution.js");
  assert.ok(polyfill >= 0, "polyfills imported");
  assert.ok(polyfill < config, "polyfills come before the feature modules that import config.js");
});

test("the service is reached from the WGT page, not only from the native host", () => {
  const webConfig = read("mods/features/webConfig.js");
  assert.match(webConfig, /typeof window\.tizen !== "undefined"/);
  // The native-host check is kept, so the Tizen module path is unchanged.
  assert.match(webConfig, /!!nativeHost\(\)/);
});
