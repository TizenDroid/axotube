// A redirect from /cors-bypass/ must stay on the proxy when it points at an allowed
// googlevideo host. Otherwise the browser follows it straight to the media host from
// the localhost page, without Access-Control-Allow-Origin, and playback fails.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const URL = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(ROOT, "service/proxy.js"), "utf8").replace(/\r\n/g, "\n");

// Load the real helper and the allowlist it depends on from the shipped source.
function load() {
  const grab = (start, endMarker) => {
    const from = code.indexOf(start);
    assert.ok(from >= 0, start + " exists");
    return code.slice(from, code.indexOf(endMarker, from) + endMarker.length);
  };
  const body = [
    grab("var EXACT_CORS_HOSTS", "};\n"),
    grab("function isPrivateHostname", "\n}\n"),
    grab("function isAllowedCorsTarget", "\n}\n"),
    grab("function parseCorsTarget", "\n}\n"),
    grab("function rewriteCorsRedirect", "\n}\n"),
  ].join("\n");
  return new Function("PORT", "URL", "net", body + "\nreturn rewriteCorsRedirect;")(8081, URL, require("node:net"));
}

test("a googlevideo redirect from cors-bypass stays on the proxy", () => {
  const rewrite = load();
  const from = "https://redirector.googlevideo.com/videoplayback?id=abc";
  const out = rewrite("https://rr4---sn-test.googlevideo.com/videoplayback?id=abc&x=1", from);
  assert.equal(out, "http://localhost:8081/cors-bypass/https://rr4---sn-test.googlevideo.com/videoplayback?id=abc&x=1");
});

test("a relative redirect is resolved against the upstream URL before it is wrapped", () => {
  const rewrite = load();
  const out = rewrite("/videoplayback?id=abc", "https://rr4---sn-test.googlevideo.com/x");
  assert.equal(out, "http://localhost:8081/cors-bypass/https://rr4---sn-test.googlevideo.com/videoplayback?id=abc");
});

test("a redirect to a host outside the allowlist is returned unchanged", () => {
  const rewrite = load();
  const from = "https://redirector.googlevideo.com/x";
  assert.equal(rewrite("https://example.com/y", from), "https://example.com/y");
  // An allowed host over plain http stays on the proxy; the proxy upgrades it to https.
  assert.equal(rewrite("http://rr4---sn-test.googlevideo.com/y", from), "http://localhost:8081/cors-bypass/http://rr4---sn-test.googlevideo.com/y");
});

test("the proxy routes cors-bypass redirects through the helper", () => {
  const src = fs.readFileSync(path.join(ROOT, "service/proxy.js"), "utf8");
  assert.match(src, /if \(lower === 'location'\) \{/);
  assert.match(src, /isCorsBypass\s*\?\s*rewriteCorsRedirect\(location, targetUrl\)/);
});
