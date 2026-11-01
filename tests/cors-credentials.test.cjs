"use strict";
// Credentialed requests (the googlevideo playback POST) need an echoed origin,
// because browsers refuse "Access-Control-Allow-Origin: *" with credentials.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const proxy = fs.readFileSync(path.join(ROOT, "service/proxy.js"), "utf8");
const java = fs.readFileSync(path.join(ROOT, "android/app/src/main/java/org/axotube/tv/LocalProxy.java"), "utf8");

test("proxy.js echoes allowed origins with credentials and keeps the wildcard otherwise", () => {
  assert.match(proxy, /function corsOriginFor\(origin\)/);
  assert.match(proxy, /\/\^https\?:\\\/\\\/\(localhost\|127\\\.0\\\.0\\\.1\)\(:\\d\+\)\?\$\/i/);
  assert.match(proxy, /Access-Control-Allow-Credentials', 'true'/);
  assert.match(proxy, /res\.setHeader\('Access-Control-Allow-Origin', origin \|\| '\*'\)/);
  // Every CORS response path goes through applyCors, none sets a bare wildcard.
  assert.doesNotMatch(proxy, /setHeader\('Access-Control-Allow-Origin', '\*'\);\s*\n\s*(?!\s*\/\/)/);
  assert.strictEqual((proxy.match(/applyCors\(req, res\)/g) || []).length, 3); // definition + two calls
});

test("LocalProxy.java echoes allowed origins with credentials", () => {
  assert.match(java, /static String corsOrigin\(String origin\)/);
  assert.match(java, /Access-Control-Allow-Credentials: true/);
  assert.match(java, /sendPreflight\(output, req\.headers\.get\("access-control-request-headers"\), req\.headers\.get\("origin"\)\)/);
  assert.match(java, /startResponse\(output, code, rewritten, true, hasBody, -1, req\.headers\.get\("origin"\)\)/);
});

test("corsOriginFor behaves as intended (evaluated from the source)", () => {
  const body = /function corsOriginFor\(origin\) \{([\s\S]*?)\n\}/.exec(proxy)[1];
  const corsOriginFor = new Function("origin", body);
  assert.strictEqual(corsOriginFor("http://localhost:8081"), "http://localhost:8081");
  assert.strictEqual(corsOriginFor("http://127.0.0.1:8081"), "http://127.0.0.1:8081");
  assert.strictEqual(corsOriginFor("https://www.youtube.com"), "https://www.youtube.com");
  assert.strictEqual(corsOriginFor("https://evil.example"), null);
  assert.strictEqual(corsOriginFor("http://localhost.evil.example"), null);
  assert.strictEqual(corsOriginFor(undefined), null);
});
