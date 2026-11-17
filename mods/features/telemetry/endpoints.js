/**
 * Request URL rules for telemetry. Pure; no side effects.
 *
 * Ad tracking is on by default. View and quality-of-life statistics are an
 * optional group that is off by default. /youtubei/v1/log_event is never blocked
 * here: YouTube uses it for home and recommendation tracking, and blocking it
 * could change what gets recommended.
 */
export const AD_TELEMETRY_PATHS = ["/pagead/", "/ptracking", "/eligibility_check"];

// Event logging (clicks, impressions, interactions). YouTube also uses it to shape home and
// recommendations, so it is blocked only when the setting says so.
export const EVENT_LOG_PATHS = ["/youtubei/v1/log_event"];

export const VIEW_STATS_PATHS = [
  "/api/stats/watchtime",
  "/api/stats/playback",
  "/api/stats/qoe",
  "/api/stats/atr",
];

function matchesAny(url, paths) {
  for (let i = 0; i < paths.length; i++) {
    if (url.indexOf(paths[i]) !== -1) return true;
  }
  return false;
}

export function shouldBlockRequestUrl(url, flags) {
  if (typeof url !== "string" || !url) return false;
  if (flags.ads && matchesAny(url, AD_TELEMETRY_PATHS)) return true;
  if (flags.viewStats && matchesAny(url, VIEW_STATS_PATHS)) return true;
  if (flags.eventLogging && matchesAny(url, EVENT_LOG_PATHS)) return true;
  return false;
}
