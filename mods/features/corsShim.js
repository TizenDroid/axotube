// Runtime CORS shim for the local proxy.
//
// The proxy serves YouTube from http://localhost:<port>, so every fetch or XHR
// to another origin is cross-origin, and gstatic.com and youtube.com do not
// allow localhost. The proxy's text rewrite only catches literal strings in the
// HTML and JS it serves. YouTube builds many URLs at runtime (for example
// "https://www.gstatic.com/youtube/img/icons/..."), so those reach the network
// directly and fail with a CORS error. This shim sends allowlisted requests
// through /cors-bypass/ on the same proxy, where the proxy adds the CORS headers.
//
// The host list must match EXACT_CORS_HOSTS in service/proxy.js. The tests check
// that. Only https targets are rewritten, and only when the page is served from
// localhost or 127.0.0.1. Anything else is left alone.

var SHIM_HOSTS = {
  "www.gstatic.com": true,
  "yt3.ggpht.com": true,
  "clients1.google.com": true,
  "s.youtube.com": true,
  "jnn-pa.googleapis.com": true,
  "yt3.googleusercontent.com": true,
  "redirector.googlevideo.com": true,
  "www.youtube.com": true,
  "youtube.com": true,
};

function isShimHost(host) {
  var h = String(host || "").toLowerCase();
  if (SHIM_HOSTS[h]) return true;
  return h === "googlevideo.com" || h.slice(-16) === ".googlevideo.com";
}

// Returns the proxied URL for a request that needs it, or null to leave it as is.
export function rewriteForProxy(win, raw) {
  var loc = win.location;
  if (!loc || (loc.hostname !== "localhost" && loc.hostname !== "127.0.0.1")) return null;
  var a = win.document.createElement("a");
  a.href = String(raw);
  var abs = String(a.href || "");
  var m = /^https:\/\/([^\/?#:]+)/i.exec(abs);
  if (!m || !isShimHost(m[1])) return null;
  return loc.origin + "/cors-bypass/" + abs;
}

export function installCorsShim(win) {
  if (!win || win.__axotubeCorsShim) return;
  win.__axotubeCorsShim = true;

  if (typeof win.fetch === "function") {
    var origFetch = win.fetch;
    win.fetch = function (input, init) {
      try {
        var isRequest = !!input && typeof input === "object" && typeof input.url === "string";
        var rewritten = rewriteForProxy(win, isRequest ? input.url : input);
        if (rewritten) {
          if (!isRequest) {
            input = rewritten;
          } else if (input.method === "GET" || input.method === "HEAD") {
            // Carry over the simple fields. A body would need a stream copy, so
            // requests with a body keep their original URL.
            input = new win.Request(rewritten, {
              method: input.method,
              headers: input.headers,
              credentials: "omit",
              mode: "cors",
            });
          }
        }
      } catch (e) {
        // Fall back to the request as the page made it.
      }
      return origFetch.call(win, input, init);
    };
  }

  var XHR = win.XMLHttpRequest;
  if (XHR && XHR.prototype && typeof XHR.prototype.open === "function") {
    var origOpen = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      try {
        var rewritten = rewriteForProxy(win, url);
        if (rewritten) args[1] = rewritten;
      } catch (e) {
        // Fall back to the original URL.
      }
      return origOpen.apply(this, args);
    };
  }
}
