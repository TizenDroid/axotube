"use strict";
// A POST whose body was buffered is retried once after a reset on a reused
// socket (the seek failure). A streamed body is still not retried.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const code = fs.readFileSync(path.join(ROOT, "service/proxy.js"), "utf8");

function loadFetchUpstream(fakeFetch) {
  const start = code.indexOf("function fetchUpstream(url, options, retriesLeft)");
  assert.ok(start >= 0, "fetchUpstream exists");
  const end = code.indexOf("\n}\n", start) + 3;
  return new Function("fetch", code.slice(start, end) + "\nreturn fetchUpstream;")(fakeFetch);
}

function resetError() {
  const e = new Error("socket hang up");
  e.code = "ECONNRESET";
  return e;
}

test("a buffered POST body is sent again after a stale-socket reset", async () => {
  const bodies = [];
  let calls = 0;
  const fakeFetch = (url, options) => {
    calls += 1;
    bodies.push(options.body);
    if (calls === 1) return Promise.reject(resetError());
    return Promise.resolve({ status: 200 });
  };
  const fetchUpstream = loadFetchUpstream(fakeFetch);
  const body = Buffer.from("segment-request");
  const res = await fetchUpstream("https://rr1.googlevideo.com/videoplayback", { body }, 1);
  assert.equal(res.status, 200);
  assert.equal(calls, 2);
  assert.equal(bodies[1].toString(), "segment-request");
});

test("a streamed POST body is still not retried", async () => {
  let calls = 0;
  const fakeFetch = () => {
    calls += 1;
    return Promise.reject(resetError());
  };
  const fetchUpstream = loadFetchUpstream(fakeFetch);
  await assert.rejects(fetchUpstream("https://rr1.googlevideo.com/videoplayback", { body: { pipe() {} } }, 1));
  assert.equal(calls, 1);
});

test("the proxy buffers the body before forwarding it", () => {
  assert.ok(code.includes("req.rawBody = Buffer.concat(chunks);"), "body is buffered");
  assert.ok(code.includes("body: hasBody ? req.rawBody : undefined,"), "buffered body is forwarded");
});
