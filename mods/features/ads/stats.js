/**
 * Counters and debug logging for the ad filters. Counters are always kept
 * (cheap, read from the console as window.__axotubeAdblockStats). Logging is
 * only emitted when window.__axotubeAdblockDebug === true.
 */
export function bump(key, n) {
  try {
    if (typeof window === "undefined") return;
    const stats = window.__axotubeAdblockStats || (window.__axotubeAdblockStats = {});
    stats[key] = (stats[key] || 0) + (n === undefined ? 1 : n);
  } catch (err) {
    // Counters must never break a filter.
  }
}

export function debugLog() {
  try {
    if (typeof window === "undefined" || window.__axotubeAdblockDebug !== true) return;
    if (typeof console === "undefined") return;
    const args = ["[AxoTube:adblock]"].concat(Array.prototype.slice.call(arguments));
    console.log.apply(console, args);
  } catch (err) {
    // Logging is best-effort.
  }
}
