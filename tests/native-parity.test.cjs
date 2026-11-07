"use strict";
// Native parity for the proxied player. A proxied page must send the same
// cookies and the same euri value the native YouTube page sends, so the server
// sees the same session. Checked against the shipped sources, not copies.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8").replace(/\r\n/g, "\n");

function loadBuildUpstreamHeaders() {
  const code = read("service/proxy.js");
  const mapStart = code.indexOf("var COOKIE_CORS_HOSTS");
  assert.ok(mapStart >= 0, "COOKIE_CORS_HOSTS exists");
  const mapEnd = code.indexOf("};", mapStart) + 2;
  const fnStart = code.indexOf("function buildUpstreamHeaders(");
  const fnEnd = code.indexOf("\n}\n", fnStart) + 3;
  return new Function(code.slice(mapStart, mapEnd) + "\n" + code.slice(fnStart, fnEnd) + "\nreturn buildUpstreamHeaders;")();
}

function loadRewriteTrustedText() {
  const code = read("service/proxy.js");
  const start = code.indexOf("function rewriteTrustedText(text)");
  assert.ok(start >= 0, "rewriteTrustedText exists");
  const end = code.indexOf("\n}\n", start) + 3;
  return new Function("PORT", code.slice(start, end) + "\nreturn rewriteTrustedText;")(8081);
}

const LOGIN = "__LocalSecure-3PSID=abc; __LocalHost-x=1; other=2";
const REVERSED = "__Secure-3PSID=abc; __Host-x=1; other=2";
const req = { headers: { cookie: LOGIN, "user-agent": "TV" } };
const host = (h) => ({ host: h, hostname: h });

test("cors-bypass to YouTube sends the login cookies, with the original cookie names", () => {
  const build = loadBuildUpstreamHeaders();
  assert.equal(build(req, host("www.youtube.com"), true).cookie, REVERSED);
  assert.equal(build(req, host("youtube.com"), true).cookie, REVERSED);
});

test("cors-bypass to googlevideo and other hosts stays cookie-free", () => {
  const build = loadBuildUpstreamHeaders();
  assert.equal(build(req, host("rr1---sn-abc.googlevideo.com"), true).cookie, undefined);
  assert.equal(build(req, host("jnn-pa.googleapis.com"), true).cookie, undefined);
  assert.equal(build(req, host("www.gstatic.com"), true).cookie, undefined);
});

test("normal proxied requests keep the cookies with the original names", () => {
  const build = loadBuildUpstreamHeaders();
  assert.equal(build(req, host("www.youtube.com"), false).cookie, REVERSED);
});

test("authorization is still dropped on cors-bypass, even for YouTube hosts", () => {
  const build = loadBuildUpstreamHeaders();
  const withAuth = { headers: { cookie: LOGIN, authorization: "Bearer x" } };
  assert.equal(build(withAuth, host("www.youtube.com"), true).authorization, undefined);
});

test("an empty euri is rewritten to the youtube.com origin (the rule that played video)", () => {
  const rewrite = loadRewriteTrustedText();
  const out = rewrite('{euri:"",c:1}');
  assert.ok(out.includes("euri:document.location.toString()"), out);
});

test("a non-empty simple euri is still rewritten to the youtube.com origin", () => {
  const rewrite = loadRewriteTrustedText();
  const out = rewrite("{euri:a.b,c:1}");
  assert.ok(out.includes("euri:document.location.toString()"), out);
});

test("the Java euri pattern is the same regex as the Node pattern", () => {
  const proxy = read("service/proxy.js");
  const node = /\/(euri:.*?)\/g/.exec(proxy);
  assert.ok(node, "Node euri regex found");
  const java = read("android/app/src/main/java/org/axotube/tv/LocalProxy.java");
  const lit = /replace\(text, "(euri:(?:[^"\\]|\\.)*)"/.exec(java);
  assert.ok(lit, "Java euri literal found");
  // Undo Java string escaping (\" and \\) to get the regex the Java side compiles.
  const javaRegex = lit[1].replace(/\\(.)/g, "$1");
  assert.equal(javaRegex, node[1]);
});

test("the Java proxy has the same cookie host list and cookie rule as Node", () => {
  const java = read("android/app/src/main/java/org/axotube/tv/LocalProxy.java");
  assert.ok(java.includes('COOKIE_CORS_HOSTS = new HashSet<>(Arrays.asList("www.youtube.com", "youtube.com"))'));
  assert.ok(java.includes('("cookie".equals(key) && !cookieHost)'));
  assert.ok(java.includes('Arrays.asList("authorization", "proxy-authorization", "x-axotube-token")'));
});
