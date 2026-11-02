"use strict";
// The proxy's media path, end to end, through a fake upstream: parallel Range
// requests as a seek makes them, a stale-socket retry during a range request,
// redirects, an http:// target, errors, and the small-answer log.
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const lock = require(path.join(ROOT, "tests", "support", "port-lock.cjs"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bodyFor(start, end) {
  const b = Buffer.alloc(end - start + 1);
  for (let i = 0; i < b.length; i++) b[i] = (start + i) % 251;
  return b;
}

function startProxy() {
  const child = spawn(process.execPath, [path.join(ROOT, "tests", "support", "proxy-upstream-harness.cjs")], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const out = { text: "" };
  child.stdout.on("data", (c) => { out.text += c.toString("utf8"); });
  child.stderr.on("data", (c) => { out.text += c.toString("utf8"); });
  out.stop = () => new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once("exit", () => resolve());
    child.kill("SIGKILL");
  });
  return out;
}

async function waitForProxy() {
  const end = Date.now() + 20000;
  while (Date.now() < end) {
    const ok = await new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:8081/axotube/health", (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => { req.abort(); resolve(false); });
    });
    if (ok) return;
    await sleep(150);
  }
  throw new Error("proxy did not start");
}

// GET through the proxy. Resolves { status, headers, body (Buffer) }.
function get(pathAndQuery, headers) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: 8081, path: pathAndQuery, headers: headers || {} }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("error", reject);
  });
}

const MEDIA = "/cors-bypass/https://rr1---sn-test.googlevideo.com/videoplayback?";

async function withProxy(fn) {
  await lock.acquire();
  const proxy = startProxy();
  try {
    await waitForProxy();
    return await fn(proxy);
  } finally {
    await proxy.stop();
    lock.release();
  }
}

test("parallel range requests, as a seek sends them, each get their own bytes and 206", { timeout: 60000 }, async () => {
  await withProxy(async (proxy) => {
    const ranges = [[1000, 1999], [3000, 3099], [0, 499]];
    const results = await Promise.all(ranges.map(([a, b]) =>
      get(MEDIA + "rn=1&id=seek", { range: "bytes=" + a + "-" + b })));
    results.forEach((r, i) => {
      const [a, b] = ranges[i];
      assert.equal(r.status, 206, "range " + a + "-" + b);
      assert.equal(r.headers["content-range"], "bytes " + a + "-" + b + "/5000");
      assert.equal(r.body.length, b - a + 1, "length of " + a + "-" + b);
      assert.ok(r.body.equals(bodyFor(a, b)), "bytes of " + a + "-" + b);
    });
    assert.match(proxy.text, /upstream GET https:\/\/rr1---sn-test\.googlevideo\.com\/videoplayback rn=1 range=bytes=1000-1999/);
  });
});

test("a range request whose reused socket was reset is retried once and still answers", { timeout: 60000 }, async () => {
  await withProxy(async (proxy) => {
    const r = await get(MEDIA + "rn=7", { range: "bytes=100-199" });
    assert.equal(r.status, 206);
    assert.ok(r.body.equals(bodyFor(100, 199)));
    const attempts = proxy.text.split("\n").filter((l) => /upstream GET .*rn=7/.test(l));
    assert.equal(attempts.length, 2, "the reset request was sent twice");
  });
});

test("an http:// media target goes upstream over https", { timeout: 60000 }, async () => {
  await withProxy(async (proxy) => {
    const r = await get("/cors-bypass/http://rr1---sn-test.googlevideo.com/videoplayback?rn=2", { range: "bytes=0-9" });
    assert.equal(r.status, 206);
    assert.match(proxy.text, /upstream GET https:\/\/rr1---sn-test\.googlevideo\.com\/videoplayback rn=2/);
    assert.doesNotMatch(proxy.text, /upstream GET http:\/\//);
  });
});

test("a redirect to another media host stays on the proxy", { timeout: 60000 }, async () => {
  await withProxy(async () => {
    const r = await get("/cors-bypass/https://rr1---sn-test.googlevideo.com/redirect");
    assert.equal(r.status, 302);
    assert.equal(r.headers.location, "http://localhost:8081/cors-bypass/https://rr2---sn-test.googlevideo.com/videoplayback?rn=99");
  });
});

test("an upstream error is passed on and logged with its status", { timeout: 60000 }, async () => {
  await withProxy(async (proxy) => {
    const r = await get(MEDIA + "rn=403", { range: "bytes=0-9" });
    assert.equal(r.status, 403);
    assert.match(proxy.text, /\[AxoTube:proxy\] 403 \/videoplayback range=bytes=0-9 length=\?/);
  });
});

test("a much-too-small range answer is logged for the seek investigation", { timeout: 60000 }, async () => {
  await withProxy(async (proxy) => {
    const r = await get(MEDIA + "rn=tiny", { range: "bytes=1000-4999" });
    assert.equal(r.status, 206);
    // The fake answers the first 1200 bytes of the file, so a range starting at 1000
    // gets 200 bytes back: far less than asked for.
    assert.match(proxy.text, /\[AxoTube:proxy\] 206 \/videoplayback range=bytes=1000-4999 length=200/);
  });
});

test("hosts outside the allowlist are still refused", { timeout: 60000 }, async () => {
  await withProxy(async () => {
    const r = await get("/cors-bypass/https://evil.example.com/videoplayback?rn=1");
    assert.equal(r.status, 403);
  });
});
