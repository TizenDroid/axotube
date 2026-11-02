"use strict";
// The pieces that have to agree across files: the WGT's launch URL, the proxy
// route that answers it, the proxy's upgrade of plain http targets, and the
// order of routes in the proxy (the launch route must come before the catch-all).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("index.html asks the route the proxy mounts", () => {
  const html = read("standalone/index.html");
  const proxy = read("service/proxy.js");
  assert.ok(html.indexOf("http://127.0.0.1:8081/axotube/launch/next") !== -1, "WGT calls the launch route");
  assert.ok(/mountRoutes\(app, bundleText\)/.test(proxy), "proxy mounts the launcher");
  assert.ok(proxy.indexOf("mountRoutes(app, bundleText)") < proxy.indexOf("app.all('*'"), "launch route is mounted before the catch-all");
});

test("index.html only reaches the proxy page as a fallback", () => {
  const html = read("standalone/index.html");
  const handOff = /function handOff\(fallbackUrl\) \{[\s\S]*?\r?\n        \}\r?\n/.exec(html);
  assert.ok(handOff, "handOff exists");
  assert.ok(!/location\.href = target/.test(html), "openYouTube no longer navigates directly");
  assert.ok(/handOff\(target\)/.test(html), "openYouTube hands off");
  assert.ok(/state\.action === "exit"/.test(handOff[0]) && /action === "wait"/.test(handOff[0]), "handles exit and wait");
});

test("the proxy upgrades plain http targets for allowed hosts before the allowlist check", () => {
  const proxy = read("service/proxy.js");
  const body = /function parseCorsTarget\(rawTarget\) \{[\s\S]*?\n\}/.exec(proxy)[0];
  const upgrade = body.indexOf("'https://' + decoded.slice");
  const check = body.indexOf("isAllowedCorsTarget(parsed)");
  assert.ok(upgrade !== -1, "upgrade present");
  assert.ok(upgrade < check, "upgrade happens before the https-only allowlist check");
});

test("stale keep-alive resets are retried once, and never for a streamed body", () => {
  const proxy = read("service/proxy.js");
  const body = /function fetchUpstream\([\s\S]*?\n\}/.exec(proxy)[0];
  assert.ok(/ECONNRESET/.test(body) && /retriesLeft > 0/.test(body), "retries stale sockets");
  assert.ok(/!options\.body/.test(body), "a streamed body is not replayed");
  assert.ok(/fetchUpstream\(targetUrl, fetchOptions, 1\)/.test(proxy), "the catch-all uses the retry");
});

test("the injector and the proxy inline the same bundle files", () => {
  const proxy = read("service/proxy.js");
  assert.ok(/bundleUpdater\.filePath\(name\)/.test(proxy), "bundleText reads the same files the proxy serves");
  const launcher = read("service/cdp/launcher.js");
  assert.ok(/readBundle\("early\.js"\)/.test(launcher) && /readBundle\("userScript\.js"\)/.test(launcher));
});
