import { configRead } from "../../config.js";
import { bump, debugLog } from "../ads/stats.js";
import { shouldBlockRequestUrl } from "./endpoints.js";

// A request that is cancelled is replaced by an empty JSON document. This
// keeps the page's callbacks running without the request leaving the device.
const BLANK_JSON_URL = "data:application/json,{}";

function currentFlags() {
  return {
    ads: configRead("blockAdTelemetry") !== false,
    viewStats: !!configRead("blockViewStatsTelemetry"),
  };
}

function isBlocked(url) {
  return shouldBlockRequestUrl(url, currentFlags());
}

/**
 * Wraps XMLHttpRequest.open, fetch and navigator.sendBeacon. Each wrapper
 * chains to whatever was installed before it (the CORS shim wraps fetch), so
 * neither wrapper replaces the other.
 */
export function installTelemetryHooks(win) {
  if (!win || win.__axotubeTelemetryHooks) return;
  win.__axotubeTelemetryHooks = true;

  const XHR = win.XMLHttpRequest;
  if (XHR && XHR.prototype && typeof XHR.prototype.open === "function") {
    const origOpen = XHR.prototype.open;
    XHR.prototype.open = function (method, url) {
      const args = Array.prototype.slice.call(arguments);
      try {
        if (isBlocked(url)) {
          bump("telemetryBlocked");
          debugLog("blocked XHR", url);
          args[0] = "GET";
          args[1] = BLANK_JSON_URL;
        }
      } catch (err) {
        debugLog("telemetry XHR hook error", err);
      }
      return origOpen.apply(this, args);
    };
  }

  if (typeof win.fetch === "function") {
    const origFetch = win.fetch;
    win.fetch = function (input) {
      try {
        const url = typeof input === "string" ? input : input && input.url;
        if (isBlocked(url)) {
          bump("telemetryBlocked");
          debugLog("blocked fetch", url);
          if (typeof win.Response === "function" && typeof Promise === "function") {
            return Promise.resolve(
              new win.Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
            );
          }
          return origFetch.call(this, BLANK_JSON_URL);
        }
      } catch (err) {
        debugLog("telemetry fetch hook error", err);
      }
      return origFetch.apply(this, arguments);
    };
  }

  const nav = win.navigator;
  if (nav && typeof nav.sendBeacon === "function") {
    const origBeacon = nav.sendBeacon;
    nav.sendBeacon = function (url) {
      try {
        if (isBlocked(url)) {
          bump("telemetryBlocked");
          debugLog("blocked beacon", url);
          return true;
        }
      } catch (err) {
        debugLog("telemetry beacon hook error", err);
      }
      return origBeacon.apply(this, arguments);
    };
  }
}
