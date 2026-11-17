"use strict";
// Continuation prefetch. The pure parts: finding the next page's token, matching the token a
// request asks for, the early-page store. The hook runs against a fake XMLHttpRequest: the
// early request is sent once the page is in, its copy is served only to the exact token,
// and every other request goes to the network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { blankSyntax } = require("./support/module-source.cjs");

const ROOT = path.join(__dirname, "..");
const SOURCE = blankSyntax(fs.readFileSync(path.join(ROOT, "mods/features/continuationPrefetch.js"), "utf8"));

function loadModule(config, timers) {
  return new Function(
    "configRead",
    "bump",
    "debugLog",
    "Event",
    "setTimeout",
    SOURCE +
      "\nreturn { nextContinuationToken, requestedContinuationToken, swapContinuationToken, createPrefetchStore, installContinuationPrefetch, PREFETCH_TTL_MS, PREFETCH_KEEP, BROWSE_PATH };",
  )(
    (key) => config[key],
    () => {},
    () => {},
    class Event {
      constructor(type) {
        this.type = type;
      }
    },
    (fn) => {
      timers.push(fn);
      return timers.length;
    },
  );
}

test("the next page's token is found in either form a response uses", () => {
  const timers = [];
  const m = loadModule({}, timers);
  assert.equal(m.nextContinuationToken('{"continuationCommand":{"token":"TOKEN_A","request":"x"}}'), "TOKEN_A");
  assert.equal(m.nextContinuationToken('{"nextContinuationData":{"continuation":"TOKEN_B"}}'), "TOKEN_B");
  assert.equal(m.nextContinuationToken('{"no":"token here"}'), null);
  assert.equal(m.nextContinuationToken(undefined), null);
});

test("a request's continuation token is read from its body, and swapped as a whole value only", () => {
  const timers = [];
  const m = loadModule({}, timers);
  const body = '{"context":{},"continuation":"ABC"}';
  assert.equal(m.requestedContinuationToken(body), "ABC");
  assert.equal(m.requestedContinuationToken('{"browseId":"x"}'), null);
  assert.equal(m.swapContinuationToken(body, "ABC", "XYZ"), '{"context":{},"continuation":"XYZ"}');
  // A token that is a prefix of another is not replaced inside it.
  assert.equal(m.swapContinuationToken('{"a":"ABCD","b":"ABC"}', "ABC", "XYZ"), '{"a":"ABCD","b":"XYZ"}');
});

test("the store keeps at most PREFETCH_KEEP pages, each only for PREFETCH_TTL_MS", () => {
  const timers = [];
  const m = loadModule({}, timers);
  let t = 0;
  const store = m.createPrefetchStore(() => t);
  store.put("A", "pageA");
  store.put("B", "pageB");
  store.put("C", "pageC");
  assert.equal(store.size(), m.PREFETCH_KEEP);
  assert.equal(store.has("A"), false, "the oldest is dropped");
  t = m.PREFETCH_TTL_MS + 1;
  assert.equal(store.has("C"), false, "expired");
});

test("a stored page is handed out once", () => {
  const timers = [];
  const m = loadModule({}, timers);
  const store = m.createPrefetchStore(() => 0);
  store.put("A", "pageA");
  assert.equal(store.take("A"), "pageA");
  assert.equal(store.take("A"), null);
});

// ---- the XHR hook, against a fake XMLHttpRequest ------------------------------------------

function fakeWindow(config) {
  const timers = [];
  const m = loadModule(config, timers);
  const sent = [];
  const created = [];
  class FakeXHR {
    constructor() {
      this.listeners = {};
      this.readyState = 0;
      this.status = 0;
      this.responseText = "";
      this.headers = {};
      created.push(this);
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name, value) {
      this.headers[name] = value;
    }
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    }
    dispatchEvent(event) {
      (this.listeners[event.type] || []).forEach((fn) => fn.call(this, event));
    }
    send(body) {
      sent.push({ xhr: this, body });
    }
  }
  const win = { XMLHttpRequest: FakeXHR };
  const store = m.createPrefetchStore(() => 0);
  m.installContinuationPrefetch(win, store);
  return { win, store, sent, created, timers, m };
}

const BROWSE = "https://www.youtube.com/youtubei/v1/browse?prettyPrint=false";
const HEADERS = { authorization: "SAPISIDHASH 1700_x", "content-type": "application/json" };

test("off: a browse request goes to the network untouched and nothing is fetched early", () => {
  const w = fakeWindow({ prefetchContinuations: false });
  const xhr = new w.win.XMLHttpRequest();
  xhr.open("POST", BROWSE);
  xhr.send('{"continuation":"T1"}');
  xhr.status = 200;
  xhr.responseText = '{"continuationCommand":{"token":"T2"}}';
  xhr.dispatchEvent({ type: "load" });
  assert.equal(w.sent.length, 1, "only the app's own request");
  assert.equal(w.created.length, 1);
});

test("on: the page's response starts the request for the next page, with the same headers", () => {
  const w = fakeWindow({ prefetchContinuations: true });
  const xhr = new w.win.XMLHttpRequest();
  xhr.open("POST", BROWSE);
  for (const h of Object.keys(HEADERS)) xhr.setRequestHeader(h, HEADERS[h]);
  xhr.send('{"continuation":"T1"}');
  xhr.status = 200;
  xhr.responseText = '{"continuationCommand":{"token":"T2"}}';
  xhr.dispatchEvent({ type: "load" });
  assert.equal(w.created.length, 2, "one early request was created");
  const early = w.created[1];
  assert.equal(early.url, BROWSE);
  assert.equal(early.headers.authorization, HEADERS.authorization);
  assert.equal(w.sent[1].body, '{"continuation":"T2"}');
  early.status = 200;
  early.responseText = "PAGE_TWO";
  early.dispatchEvent({ type: "load" });
  assert.equal(w.store.has("T2"), true);
});

test("on: the app's request for that exact token is answered from the early copy, not the network", () => {
  const w = fakeWindow({ prefetchContinuations: true });
  const first = new w.win.XMLHttpRequest();
  first.open("POST", BROWSE);
  first.send('{"continuation":"T1"}');
  first.status = 200;
  first.responseText = '{"continuationCommand":{"token":"T2"}}';
  first.dispatchEvent({ type: "load" });
  const early = w.created[1];
  early.status = 200;
  early.responseText = "PAGE_TWO";
  early.dispatchEvent({ type: "load" });

  const sentBefore = w.sent.length;
  const asked = new w.win.XMLHttpRequest();
  let loaded = null;
  asked.addEventListener("load", function () {
    loaded = { status: this.status, text: this.responseText, state: this.readyState };
  });
  asked.open("POST", BROWSE);
  asked.send('{"continuation":"T2"}');
  assert.equal(w.sent.length, sentBefore, "the network was not used for it");
  w.timers.forEach((fn) => fn());
  assert.deepEqual(loaded, { status: 200, text: "PAGE_TWO", state: 4 });
});

test("a request for any other token goes to the network as usual", () => {
  const w = fakeWindow({ prefetchContinuations: true });
  const xhr = new w.win.XMLHttpRequest();
  xhr.open("POST", BROWSE);
  xhr.send('{"continuation":"NOT_STORED"}');
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].xhr, xhr);
});

test("a browse request with no continuation (a first page) is not prefetched from", () => {
  const w = fakeWindow({ prefetchContinuations: true });
  const xhr = new w.win.XMLHttpRequest();
  xhr.open("POST", BROWSE);
  xhr.send('{"browseId":"FEwhat_to_watch"}');
  xhr.status = 200;
  xhr.responseText = '{"continuationCommand":{"token":"T2"}}';
  xhr.dispatchEvent({ type: "load" });
  assert.equal(w.created.length, 1, "no early request");
});

test("requests that are not browse calls are left alone", () => {
  const w = fakeWindow({ prefetchContinuations: true });
  const xhr = new w.win.XMLHttpRequest();
  xhr.open("POST", "https://www.youtube.com/youtubei/v1/player");
  xhr.send('{"continuation":"T1"}');
  xhr.status = 200;
  xhr.responseText = '{"continuationCommand":{"token":"T2"}}';
  xhr.dispatchEvent({ type: "load" });
  assert.equal(w.created.length, 1);
});
