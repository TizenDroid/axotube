"use strict";
// Runs the real content proxy (service/proxy.js) in a child process with node-fetch
// replaced by a fake upstream. Range, redirect and failure paths can then be checked
// without network. The fake serves a file of 5000 bytes, where the byte at offset i
// is i % 251, so a test can check every byte it receives. Lines starting with [TEST]
// describe each upstream request the proxy made.
const path = require("path");
const { Readable } = require("stream");

const ROOT = path.resolve(__dirname, "..", "..");
const serviceDir = path.join(ROOT, "service");
const FILE_SIZE = 5000;

function log(line) {
  process.stdout.write("[TEST] " + line + "\n");
}

function bodyFor(start, end) {
  const b = Buffer.alloc(end - start + 1);
  for (let i = 0; i < b.length; i++) b[i] = (start + i) % 251;
  return b;
}

function makeResponse(status, headers, body) {
  const map = {};
  Object.keys(headers).forEach((k) => { map[k.toLowerCase()] = [String(headers[k])]; });
  return {
    status: status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (k) => (map[k.toLowerCase()] ? map[k.toLowerCase()].join(", ") : null),
      raw: () => map,
    },
    body: body ? Readable.from([body]) : null,
  };
}

const seen = { rn7Reset: false };

function fakeFetch(url, opts) {
  const u = new URL(url);
  const rn = u.searchParams.get("rn");
  const range = opts.headers && opts.headers.range ? String(opts.headers.range) : null;
  log("upstream " + opts.method + " " + u.protocol + "//" + u.hostname + u.pathname + " rn=" + rn + " range=" + (range || "-"));

  // Anything that is not a media host behaves as an offline network (the bundle check).
  if (!/\.googlevideo\.com$/.test(u.hostname)) {
    return Promise.reject(Object.assign(new Error("getaddrinfo ENOTFOUND " + u.hostname), { code: "ENOTFOUND" }));
  }
  if (u.pathname === "/redirect") {
    return Promise.resolve(makeResponse(302, { location: "https://rr2---sn-test.googlevideo.com/videoplayback?rn=99" }, null));
  }
  if (rn === "7" && !seen.rn7Reset) {
    // A reused keep-alive socket that the server closed: the first try fails.
    seen.rn7Reset = true;
    return Promise.reject(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
  }
  if (rn === "403") {
    return Promise.resolve(makeResponse(403, {}, null));
  }
  let start = 0;
  let end = FILE_SIZE - 1;
  if (rn === "tiny") end = 1199; // an answer that is much too small for the range
  if (range) {
    const m = /bytes=(\d+)-(\d*)/.exec(range);
    start = Number(m[1]);
    if (m[2]) end = Math.min(Number(m[2]), end);
  }
  const body = bodyFor(start, end);
  const headers = {
    "content-type": "video/mp4",
    "content-length": String(body.length),
    "accept-ranges": "bytes",
  };
  if (range) headers["content-range"] = "bytes " + start + "-" + end + "/" + FILE_SIZE;
  return Promise.resolve(makeResponse(range ? 206 : 200, headers, body));
}

const fetchPath = require.resolve("node-fetch", { paths: [serviceDir] });
require.cache[fetchPath] = {
  id: fetchPath,
  filename: fetchPath,
  loaded: true,
  exports: fakeFetch,
};

require(path.join(serviceDir, "proxy.js"));
