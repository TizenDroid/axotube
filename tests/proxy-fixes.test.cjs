"use strict";
// The proxy's changed functions, run for real. They are cut out of service/proxy.js
// by name, so the tests exercise the shipped code rather than a copy.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const URL = require("node:url");

const SRC = fs.readFileSync(path.join(__dirname, "..", "service", "proxy.js"), "utf8");

// Returns the source of a top-level "function name(...) { ... }" by brace matching.
function functionSource(name) {
  const start = SRC.indexOf("function " + name + "(");
  if (start === -1) throw new Error("missing " + name);
  let depth = 0;
  let i = SRC.indexOf("{", start);
  for (; i < SRC.length; i++) {
    if (SRC[i] === "{") depth++;
    else if (SRC[i] === "}") {
      depth--;
      if (depth === 0) return SRC.slice(start, i + 1);
    }
  }
  throw new Error("unterminated " + name);
}

const hostsBlock = /var EXACT_CORS_HOSTS = (\{[\s\S]*?\});/.exec(SRC)[1];

const corsTarget = new Function(
  "URL", "net", "EXACT_CORS_HOSTS",
  [functionSource("isPrivateHostname"), functionSource("isAllowedCorsTarget"), functionSource("parseCorsTarget"),
    "return { parseCorsTarget: parseCorsTarget, isAllowedCorsTarget: isAllowedCorsTarget };"].join("\n"),
)(URL, net, eval("(" + hostsBlock + ")"));

test("plain http to an allowed host is upgraded to https", () => {
  const p = corsTarget.parseCorsTarget("http://www.youtube.com/api/stats/watchtime?x=1");
  assert.ok(p, "accepted");
  assert.equal(p.protocol, "https:");
  assert.equal(p.hostname, "www.youtube.com");
  assert.equal(p.path, "/api/stats/watchtime?x=1");
});

test("an explicit :80 on an upgraded http URL is dropped, so it reaches the https port", () => {
  const p = corsTarget.parseCorsTarget("http://www.youtube.com:80/x");
  assert.ok(p);
  assert.equal(p.port, null);
  assert.equal(p.protocol, "https:");
});

test("the upgrade also covers googlevideo hosts and percent-encoded targets", () => {
  assert.equal(corsTarget.parseCorsTarget("http://rr4---sn-test.googlevideo.com/y").protocol, "https:");
  assert.equal(corsTarget.parseCorsTarget(encodeURIComponent("http://www.gstatic.com/a")).protocol, "https:");
});

test("hosts outside the allowlist, and private addresses, are still refused", () => {
  assert.equal(corsTarget.parseCorsTarget("http://evil.example.com/x"), null);
  assert.equal(corsTarget.parseCorsTarget("http://127.0.0.1/x"), null);
  assert.equal(corsTarget.parseCorsTarget("http://localhost/x"), null);
  assert.equal(corsTarget.parseCorsTarget("http://10.0.0.1/x"), null);
  assert.equal(corsTarget.parseCorsTarget("https://user:pw@www.youtube.com/x"), null, "credentials refused");
});

test("a stale keep-alive reset is retried once, and the second answer is used", async () => {
  let calls = 0;
  const fakeFetch = (url) => {
    calls++;
    if (calls === 1) return Promise.reject(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    return Promise.resolve({ status: 206 });
  };
  const run = new Function("fetch", functionSource("fetchUpstream") + "\nreturn fetchUpstream;")(fakeFetch);
  const res = await run("https://www.youtube.com/x", { headers: {} }, 1);
  assert.equal(res.status, 206);
  assert.equal(calls, 2);
});

test("a request with a body is never replayed", async () => {
  let calls = 0;
  const run = new Function("fetch", functionSource("fetchUpstream") + "\nreturn fetchUpstream;")(() => {
    calls++;
    return Promise.reject(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
  });
  await assert.rejects(run("https://www.youtube.com/x", { body: { pipe() {} } }, 1));
  assert.equal(calls, 1);
});

test("other failures are not retried", async () => {
  let calls = 0;
  const run = new Function("fetch", functionSource("fetchUpstream") + "\nreturn fetchUpstream;")(() => {
    calls++;
    return Promise.reject(new Error("getaddrinfo ENOTFOUND"));
  });
  await assert.rejects(run("https://www.youtube.com/x", {}, 1));
  assert.equal(calls, 1);
});

function headersOf(map) {
  return { get: (k) => (Object.prototype.hasOwnProperty.call(map, k.toLowerCase()) ? map[k.toLowerCase()] : null) };
}

function captureWarnings(fn) {
  const lines = [];
  const original = console.warn;
  console.warn = (m) => lines.push(String(m));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return lines;
}

const logSuspiciousMedia = new Function("URL", "diagnostics", functionSource("logSuspiciousMedia") + "\nreturn logSuspiciousMedia;")(URL, { record() {} });

test("a small range answer on videoplayback is logged, with its range and length", () => {
  const lines = captureWarnings(() => logSuspiciousMedia(
    { headers: { range: "bytes=1000-2000" } },
    "https://rr4.googlevideo.com/videoplayback?rn=13&id=x",
    { status: 200, headers: headersOf({ "content-length": "1234" }) },
  ));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /200 \/videoplayback range=bytes=1000-2000 length=1234/);
});

test("a normal-sized range answer is not logged", () => {
  const lines = captureWarnings(() => logSuspiciousMedia(
    { headers: { range: "bytes=0-99999" } },
    "https://rr4.googlevideo.com/videoplayback?rn=1",
    { status: 206, headers: headersOf({ "content-length": "90000" }) },
  ));
  assert.equal(lines.length, 0);
});

test("an error status is logged even with no content-length, and the length reads as unknown", () => {
  const lines = captureWarnings(() => logSuspiciousMedia(
    { headers: {} },
    "https://www.youtube.com/api/stats/watchtime",
    { status: 502, headers: headersOf({}) },
  ));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /502 \/api\/stats\/watchtime range=- length=\?/);
});
