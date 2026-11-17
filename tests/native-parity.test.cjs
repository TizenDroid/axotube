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

// The header builder and the account-header helper, cut from the shipped proxy.js.
// Fresh scope per call, so the remembered account header never carries over between tests.
function loadProxyHeaderModule() {
  const code = read("service/proxy.js");
  const mapStart = code.indexOf("var COOKIE_CORS_HOSTS");
  assert.ok(mapStart >= 0, "COOKIE_CORS_HOSTS exists");
  const fnStart = code.indexOf("function buildUpstreamHeaders(");
  const fnEnd = code.indexOf("\n}\n", fnStart) + 3;
  return new Function(
    code.slice(mapStart, fnEnd) + "\nreturn { build: buildUpstreamHeaders, remember: rememberYoutubeAuthorization };",
  )();
}

function loadBuildUpstreamHeaders() {
  return loadProxyHeaderModule().build;
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

test("the stats host s.youtube.com gets the login cookies, like the other YouTube hosts", () => {
  const build = loadBuildUpstreamHeaders();
  assert.equal(build(req, host("s.youtube.com"), true).cookie, REVERSED);
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

test("authorization the page sends is still dropped on cors-bypass, even for YouTube hosts", () => {
  const build = loadBuildUpstreamHeaders();
  const withAuth = { headers: { cookie: LOGIN, authorization: "Bearer x" } };
  assert.equal(build(withAuth, host("www.youtube.com"), true).authorization, undefined);
});

// Watch-history reports are image or beacon requests and cannot carry an Authorization
// header, so YouTube records them against no account. The proxy supplies the header that
// the page last sent on a /youtubei/ call (the same account), and only for /api/stats/.
const at = (hostname, pathname) => ({ host: hostname, hostname, pathname });
const SIGNED_IN = { headers: { cookie: LOGIN, authorization: "SAPISIDHASH 1700_abc" } };
const STATS = "/api/stats/watchtime?ver=2";

test("a stats report on s.youtube.com carries the account header the page last sent on /youtubei/", () => {
  const { build, remember } = loadProxyHeaderModule();
  remember(SIGNED_IN, at("www.youtube.com", "/youtubei/v1/player"));
  const out = build({ headers: { cookie: LOGIN } }, at("s.youtube.com", STATS), true);
  assert.equal(out.authorization, "SAPISIDHASH 1700_abc");
  assert.equal(out.cookie, REVERSED);
});

test("without a remembered account header a stats report is sent as before, with no header invented", () => {
  const { build } = loadProxyHeaderModule();
  assert.equal(build({ headers: { cookie: LOGIN } }, at("s.youtube.com", STATS), true).authorization, undefined);
});

test("the page's own header on a cors-bypass stats report is replaced by the remembered one, never forwarded", () => {
  const { build, remember } = loadProxyHeaderModule();
  remember(SIGNED_IN, at("youtube.com", "/youtubei/v1/next"));
  const pageSent = { headers: { cookie: LOGIN, authorization: "Bearer attacker" } };
  assert.equal(build(pageSent, at("s.youtube.com", STATS), true).authorization, "SAPISIDHASH 1700_abc");
});

test("the account header is only remembered from a /youtubei/ call to a YouTube host", () => {
  const { build, remember } = loadProxyHeaderModule();
  remember(SIGNED_IN, at("www.youtube.com", "/watch"));
  remember(SIGNED_IN, at("rr1.googlevideo.com", "/youtubei/v1/player"));
  assert.equal(build({ headers: {} }, at("s.youtube.com", STATS), true).authorization, undefined);
});

test("the account header goes only to stats reports, not to other YouTube requests", () => {
  const { build, remember } = loadProxyHeaderModule();
  remember(SIGNED_IN, at("www.youtube.com", "/youtubei/v1/player"));
  assert.equal(build({ headers: {} }, at("www.youtube.com", "/youtubei/v1/next"), true).authorization, undefined);
  assert.equal(build({ headers: {} }, at("rr1.googlevideo.com", STATS), true).authorization, undefined);
});

test("a normal proxied stats request keeps the header the page sent itself", () => {
  const { build, remember } = loadProxyHeaderModule();
  remember(SIGNED_IN, at("www.youtube.com", "/youtubei/v1/player"));
  const pageSent = { headers: { cookie: LOGIN, authorization: "SAPISIDHASH 9_page" } };
  assert.equal(build(pageSent, at("www.youtube.com", STATS), false).authorization, "SAPISIDHASH 9_page");
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
  assert.ok(java.includes('COOKIE_CORS_HOSTS = new HashSet<>(Arrays.asList("www.youtube.com", "youtube.com", "s.youtube.com"))'));
  assert.ok(java.includes('("cookie".equals(key) && !cookieHost)'));
  assert.ok(java.includes('Arrays.asList("authorization", "proxy-authorization", "x-axotube-token")'));
});
