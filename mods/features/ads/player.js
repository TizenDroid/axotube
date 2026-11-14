import { hasOwn } from "./rules.js";
import { bump } from "./stats.js";

// Player-level ad tracking: the attestation block and ad-break heartbeat
// parameters. They are only used for ad-break bookkeeping, not for playback.
export const PLAYER_TRACKING_KEYS = ["attestation", "adBreakHeartbeatParams"];

function stripKeys(obj) {
  let n = 0;
  for (let i = 0; i < PLAYER_TRACKING_KEYS.length; i++) {
    if (hasOwn(obj, PLAYER_TRACKING_KEYS[i])) {
      delete obj[PLAYER_TRACKING_KEYS[i]];
      n++;
    }
  }
  return n;
}

export function stripPlayerTracking(r) {
  let n = stripKeys(r);
  if (r.playerResponse && typeof r.playerResponse === "object") {
    n += stripKeys(r.playerResponse);
  }
  if (n) bump("playerTrackingRemoved", n);
  return n;
}
