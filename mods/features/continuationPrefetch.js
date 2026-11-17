// Continuation prefetch (optional; off by default).
//
// A browse page loads its rows a page at a time. When the app requests page N, the response
// names page N+1. With this on, page N+1 is requested as soon as page N arrives, so it is
// already here when the viewer reaches the end of the rows. The early copy is used only when
// the app asks for exactly that token; any other request goes to the network as usual. Copies
// are kept for a short time, and only a couple at once.
//
// Only XMLHttpRequest is handled. The TV app sends its browse requests that way.
import { configRead } from "../config.js";
import { bump, debugLog } from "./ads/stats.js";

export const PREFETCH_TTL_MS = 60000;
export const PREFETCH_KEEP = 2;
export const BROWSE_PATH = "/youtubei/v1/browse";

const NEXT_TOKEN_PATTERNS = [
  /"continuationCommand":\s*\{\s*"token":\s*"([^"]+)"/,
  /"nextContinuationData":\s*\{\s*"continuation":\s*"([^"]+)"/,
];

// The token of the next page a response names, or null.
export function nextContinuationToken(text) {
  if (typeof text !== "string") return null;
  for (let i = 0; i < NEXT_TOKEN_PATTERNS.length; i++) {
    const match = NEXT_TOKEN_PATTERNS[i].exec(text);
    if (match) return match[1];
  }
  return null;
}

// The continuation token a request asks for, or null.
export function requestedContinuationToken(body) {
  const match = /"continuation":\s*"([^"]+)"/.exec(body);
  return match ? match[1] : null;
}

// The request body with its continuation token replaced. Only whole quoted values match, so a
// token that is a prefix of another is left alone.
export function swapContinuationToken(body, fromToken, toToken) {
  return body.split('"' + fromToken + '"').join('"' + toToken + '"');
}

// Holds early pages: at most PREFETCH_KEEP, each for PREFETCH_TTL_MS, oldest dropped first.
export function createPrefetchStore(now) {
  let entries = [];
  function prune() {
    const t = now();
    entries = entries.filter((e) => t - e.at <= PREFETCH_TTL_MS);
    while (entries.length > PREFETCH_KEEP) entries.shift();
  }
  return {
    has: function (token) {
      prune();
      return entries.some((e) => e.token === token);
    },
    put: function (token, text) {
      prune();
      if (entries.some((e) => e.token === token)) return;
      entries.push({ token: token, text: text, at: now() });
      prune();
    },
    take: function (token) {
      prune();
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].token === token) {
          const text = entries[i].text;
          entries.splice(i, 1);
          return text;
        }
      }
      return null;
    },
    size: function () {
      prune();
      return entries.length;
    },
  };
}

function enabled() {
  return configRead("prefetchContinuations") === true;
}

function defineValue(obj, name, value) {
  Object.defineProperty(obj, name, { value: value, configurable: true });
}

// Completes a request from an early copy: the state the app reads, then its callbacks.
function deliver(xhr, text) {
  setTimeout(function () {
    try {
      defineValue(xhr, "readyState", 4);
      defineValue(xhr, "status", 200);
      defineValue(xhr, "responseText", text);
      defineValue(xhr, "response", text);
      if (typeof xhr.onreadystatechange === "function") xhr.onreadystatechange();
      xhr.dispatchEvent(new Event("load"));
      xhr.dispatchEvent(new Event("loadend"));
    } catch (err) {
      debugLog("continuation prefetch: delivery failed", err);
    }
  }, 0);
}

// Requests the page that follows, with the same headers, as an internal request (not hooked).
function requestEarly(win, info, body, fromToken, toToken, store) {
  const early = new win.XMLHttpRequest();
  early.__axoInternal = true;
  early.open("POST", info.url, true);
  Object.keys(info.headers).forEach(function (name) {
    early.setRequestHeader(name, info.headers[name]);
  });
  early.addEventListener("load", function () {
    if (early.status === 200) {
      store.put(toToken, early.responseText);
      bump("continuationPrefetched");
    }
  });
  early.send(swapContinuationToken(body, fromToken, toToken));
}

export function installContinuationPrefetch(win, store) {
  if (!win || win.__axotubeContinuationPrefetch) return false;
  const XHR = win.XMLHttpRequest;
  if (!XHR || !XHR.prototype || typeof XHR.prototype.send !== "function") return false;
  win.__axotubeContinuationPrefetch = true;

  const origOpen = XHR.prototype.open;
  const origSetRequestHeader = XHR.prototype.setRequestHeader;
  const origSend = XHR.prototype.send;

  XHR.prototype.open = function (method, url) {
    this.__axoRequest = {
      method: String(method).toUpperCase(),
      url: String(url),
      headers: {},
      internal: this.__axoInternal === true,
    };
    return origOpen.apply(this, arguments);
  };

  XHR.prototype.setRequestHeader = function (name, value) {
    if (this.__axoRequest) this.__axoRequest.headers[name] = value;
    return origSetRequestHeader.apply(this, arguments);
  };

  XHR.prototype.send = function (body) {
    const info = this.__axoRequest;
    const browsePost =
      info &&
      !info.internal &&
      info.method === "POST" &&
      info.url.indexOf(BROWSE_PATH) !== -1 &&
      typeof body === "string";
    if (!browsePost || !enabled()) return origSend.apply(this, arguments);

    const asked = requestedContinuationToken(body);
    if (asked) {
      const early = store.take(asked);
      if (early !== null) {
        bump("continuationPrefetchServed");
        deliver(this, early);
        return undefined;
      }
    }

    // The response to this request names the page after it: request that one early.
    const xhr = this;
    this.addEventListener("load", function () {
      if (!enabled() || !asked || xhr.status !== 200) return;
      const next = nextContinuationToken(xhr.responseText);
      if (!next || next === asked || store.has(next)) return;
      requestEarly(win, info, body, asked, next, store);
    });
    return origSend.apply(this, arguments);
  };
  return true;
}

const sharedStore = createPrefetchStore(function () {
  return Date.now();
});
installContinuationPrefetch(typeof window !== "undefined" ? window : null, sharedStore);
