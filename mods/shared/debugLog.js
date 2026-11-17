// Verbose logging. Off by default. When it is off, a debug call does no work: no string is
// built and nothing is written. Warnings and errors do not use this and are always shown.
// It is on when the "Verbose logs" setting is on, or when window.__axotubeAdblockDebug is
// true (for a console session).
import { configRead } from "../config.js";

export function debugLogsOn() {
  if (typeof window !== "undefined" && window.__axotubeAdblockDebug === true) return true;
  return !!configRead("enableDebugLogs");
}

export function debugLog() {
  try {
    if (!debugLogsOn() || typeof console === "undefined") return;
    console.log.apply(console, ["[AxoTube]"].concat(Array.prototype.slice.call(arguments)));
  } catch (err) {
    // Logging is best-effort.
  }
}
