"use strict";
// The shim is ESM source. Strip the export keywords and run it in a VM with a
// fake window, so the real code is what gets tested.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(ROOT, "mods/features/corsShim.js"), "utf8").replace(/^export /gm, "");

function makeWindow(origin) {
  const base = origin + "/watch";
  const win = {
    location: { origin, hostname: new URL(origin).hostname },
    document: {
      createElement() {
        const a = {};
        Object.defineProperty(a, "href", {
          set(v) { this._h = new URL(String(v), base).href; },
          get() { return this._h; },
        });
        return a;
      },
    },
    fetchCalls: [],
    xhrOpened: [],
  };
  win.fetch = function (input, init) { win.fetchCalls.push({ input, init }); return "resp"; };
  win.Request = function (url, init) { this.url = url; this.method = init.method; this.headers = init.headers; this.credentials = init.credentials; };
  win.XMLHttpRequest = function () {};
  win.XMLHttpRequest.prototype.open = function () { win.xhrOpened.push(Array.from(arguments)); return "xhr"; };
  return win;
}

function load(origin) {
  const win = makeWindow(origin);
  const sandbox = { window: win, URL, Array, String, RegExp, Object, Error, win };
  vm.createContext(sandbox);
  vm.runInContext(src + "\n;installCorsShim(win);", sandbox);
  return { win, sandbox };
}

test("rewrites allowlisted https hosts from a localhost page", () => {
  const { win } = load("http://localhost:8081");
  win.fetch("https://www.gstatic.com/youtube/img/icons/web/a.svg");
  assert.strictEqual(win.fetchCalls[0].input, "http://localhost:8081/cors-bypass/https://www.gstatic.com/youtube/img/icons/web/a.svg");
});

test("rewrites youtube.com, googlevideo and yt3 hosts", () => {
  const { win } = load("http://127.0.0.1:8081");
  win.fetch("https://youtube.com/");
  win.fetch("https://rr3---sn-abc.googlevideo.com/videoplayback?x=1");
  win.fetch("https://yt3.ggpht.com/a.jpg");
  assert.strictEqual(win.fetchCalls[0].input, "http://127.0.0.1:8081/cors-bypass/https://youtube.com/");
  assert.match(win.fetchCalls[1].input, /^http:\/\/127\.0\.0\.1:8081\/cors-bypass\/https:\/\/rr3---sn-abc\.googlevideo\.com\/videoplayback\?x=1$/);
  assert.strictEqual(win.fetchCalls[2].input, "http://127.0.0.1:8081/cors-bypass/https://yt3.ggpht.com/a.jpg");
});

test("leaves other hosts and non-https targets alone", () => {
  const { win } = load("http://localhost:8081");
  win.fetch("https://www.google.com/x");
  win.fetch("https://evil.example.com/gstatic.com");
  win.fetch("http://evil.example.com/plain");
  win.fetch("/relative/path");
  assert.deepStrictEqual(win.fetchCalls.map((c) => c.input), [
    "https://www.google.com/x",
    "https://evil.example.com/gstatic.com",
    "http://evil.example.com/plain",
    "/relative/path",
  ]);
});

test("upgrades http targets on allowlisted hosts and sends them through the proxy", () => {
  const { win } = load("http://localhost:8081");
  win.fetch("http://www.youtube.com/api/stats/watchtime?ver=2");
  win.fetch("http://www.gstatic.com/plain");
  assert.deepStrictEqual(win.fetchCalls.map((c) => c.input), [
    "http://localhost:8081/cors-bypass/https://www.youtube.com/api/stats/watchtime?ver=2",
    "http://localhost:8081/cors-bypass/https://www.gstatic.com/plain",
  ]);
});

test("an explicit :80 on an upgraded http target is dropped", () => {
  const { win } = load("http://localhost:8081");
  win.fetch("http://www.youtube.com:80/api/x");
  assert.equal(win.fetchCalls[0].input, "http://localhost:8081/cors-bypass/https://www.youtube.com/api/x");
});

test("upgrades http XHR targets the same way", () => {
  const { win } = load("http://localhost:8081");
  const xhr = new win.XMLHttpRequest();
  xhr.open("POST", "http://www.youtube.com/api/stats/watchtime");
  assert.deepStrictEqual(win.xhrOpened[0], ["POST", "http://localhost:8081/cors-bypass/https://www.youtube.com/api/stats/watchtime"]);
});

test("does nothing when the page is not served from localhost", () => {
  const { win } = load("https://www.youtube.com");
  win.fetch("https://www.gstatic.com/x.svg");
  assert.strictEqual(win.fetchCalls[0].input, "https://www.gstatic.com/x.svg");
});

test("does not double-wrap a URL that is already proxied", () => {
  const { win } = load("http://localhost:8081");
  win.fetch("http://localhost:8081/cors-bypass/https://www.gstatic.com/x.svg");
  assert.strictEqual(win.fetchCalls[0].input, "http://localhost:8081/cors-bypass/https://www.gstatic.com/x.svg");
});

test("rewrites a GET Request object and drops cookies", () => {
  const { win } = load("http://localhost:8081");
  win.fetch({ url: "https://www.gstatic.com/x.json", method: "GET", headers: { a: "b" } }, { mode: "cors" });
  const req = win.fetchCalls[0].input;
  assert.strictEqual(req.url, "http://localhost:8081/cors-bypass/https://www.gstatic.com/x.json");
  assert.strictEqual(req.credentials, "omit");
  assert.deepStrictEqual(win.fetchCalls[0].init, { mode: "cors" });
});

test("leaves a POST Request object with a body on its original URL", () => {
  const { win } = load("http://localhost:8081");
  const post = { url: "https://www.youtube.com/api/x", method: "POST" };
  win.fetch(post);
  assert.strictEqual(win.fetchCalls[0].input, post);
});

test("rewrites XHR open and passes the other arguments through", () => {
  const { win } = load("http://localhost:8081");
  const xhr = new win.XMLHttpRequest();
  xhr.open("GET", "https://www.gstatic.com/lottie.json", true);
  assert.deepStrictEqual(win.xhrOpened[0], ["GET", "http://localhost:8081/cors-bypass/https://www.gstatic.com/lottie.json", true]);
});

test("installs once per window", () => {
  const { win, sandbox } = load("http://localhost:8081");
  const before = win.fetch;
  vm.runInContext(src + "\n;installCorsShim(win);", sandbox);
  assert.strictEqual(win.fetch, before);
});

test("host list matches the proxy allowlist", () => {
  const proxy = fs.readFileSync(path.join(ROOT, "service/proxy.js"), "utf8");
  const block = /EXACT_CORS_HOSTS = \{([\s\S]*?)\};/.exec(proxy)[1];
  const proxyHosts = Array.from(block.matchAll(/'([^']+)'\s*:\s*true/g), (m) => m[1]).sort();
  const shimBlock = /SHIM_HOSTS = \{([\s\S]*?)\};/.exec(src)[1];
  const shimHosts = Array.from(shimBlock.matchAll(/"([^"]+)"\s*:\s*true/g), (m) => m[1]).sort();
  assert.deepStrictEqual(shimHosts, proxyHosts);
});
