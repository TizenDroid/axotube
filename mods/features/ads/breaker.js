import { bump, debugLog } from "./stats.js";

// After this many errors in one filter, that filter is switched off for the
// rest of the session. One warning is printed when it trips.
export const BREAKER_LIMIT = 5;

const breakers = {};

/**
 * Runs one filter section. A thrown error is counted and contained; the rest
 * of the response is still processed. Returns fn's result, or undefined.
 */
export function runGuarded(name, fn) {
  let state = breakers[name];
  if (!state) state = breakers[name] = { errors: 0, open: false };
  if (state.open) return undefined;
  try {
    return fn();
  } catch (err) {
    state.errors++;
    bump("error:" + name);
    debugLog("filter error", name, err);
    if (state.errors >= BREAKER_LIMIT) {
      state.open = true;
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          "[AxoTube:adblock] '" + name + "' disabled after " + BREAKER_LIMIT + " errors this session",
        );
      }
    }
    return undefined;
  }
}
