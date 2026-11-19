import { debugLogsOn } from "../shared/debugLog.js";
// The webview's user agent follows the "userAgentProfile" setting, applied with
// tizen.websetting.setUserAgentString so HTTP requests and navigator.userAgent both
// carry it. Same meaning as the Android app's profiles:
//   On Tizen, "samsung" and "auto" send the TV agent this app has always used, and "android"
//   sends a fixed phone agent (experimental: YouTube's TV layout may not suit it).
//   On Android the app sets the agent natively; "samsung" is the TV agent, and "auto" and
//   "android" are the WebView's own agent with "; wv" removed.
//
// The standalone splash page applies the TV agent first, before anything navigates to
// YouTube. This module checks the page itself. It never trusts a partial match: the
// page's navigator.userAgent must equal the agent the profile sends exactly. The
// result is kept on window.__axotubeUserAgent so it can be read back (console or
// diagnostics) rather than inferred from what YouTube shows.
//
// A mismatch is fixed by setting the agent and reloading once, so the page's own
// requests pick it up. The session guard records the agent already tried, so a
// platform that ignores the setting cannot cause a reload loop.

import { configRead } from "../config.js";

const TV_USER_AGENT =
  "Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.3 (KHTML, like Gecko) SamsungBrowser/2.1 TV Safari/537.3";
const PHONE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
// The Android TV agent, as MainActivity sends it for "auto" on the Android app.
const ANDROID_TV_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 CrKey/1.56.500000";
const TRIED_SESSION_KEY = "axotube-user-agent-tried";

// Statuses written to window.__axotubeUserAgent:
//   "applied"      the page reports exactly the wanted agent
//   "set"          the agent was set; the reload that follows will confirm it
//   "not-applied"  the page still reports something else after an attempt
//   "unavailable"  tizen.websetting is missing, so nothing can be set
// On Tizen, the profile's agent is set here (tizen.websetting). On Android the app sets it
// natively (MainActivity.resolveUserAgent), and this module only checks what the page reports:
// "auto" is the Android TV agent, "samsung" the Tizen TV agent, and "android" the WebView's own
// agent with "; wv" removed.
function onTizen() {
  return !!window.tizen;
}

function agentFor(profile) {
  if (profile === "samsung") return TV_USER_AGENT;
  if (!onTizen()) {
    if (profile === "android") return String(navigator.userAgent).replace("; wv", "");
    return ANDROID_TV_USER_AGENT;
  }
  if (profile === "android") return PHONE_USER_AGENT;
  return TV_USER_AGENT;
}

function setWebviewUserAgent(ua) {
  try {
    if (window.tizen && window.tizen.websetting && typeof window.tizen.websetting.setUserAgentString === "function") {
      window.tizen.websetting.setUserAgentString(ua);
      return true;
    }
  } catch (e) {
    console.warn("[AxoTube:userAgentSpoofing] setUserAgentString failed:", e);
  }
  return false;
}

function record(wanted, status) {
  try {
    window.__axotubeUserAgent = { wanted: wanted, actual: navigator.userAgent, status: status };
  } catch (e) {}
  if (debugLogsOn()) console.log("[AxoTube:userAgentSpoofing] " + status + ": " + navigator.userAgent);
}

function triedBefore(ua) {
  try {
    return sessionStorage.getItem(TRIED_SESSION_KEY) === ua;
  } catch (e) {
    return false;
  }
}

function markTried(ua) {
  try {
    sessionStorage.setItem(TRIED_SESSION_KEY, ua);
  } catch (e) {}
}

function applyUserAgentProfile() {
  const profile = configRead("userAgentProfile");
  const wanted = agentFor(profile);
  if (navigator.userAgent === wanted) {
    record(wanted, "applied");
    return;
  }
  if (!onTizen()) {
    // Android: the app sets the agent before the page loads. Nothing to set here, no reload.
    record(wanted, "not-applied");
    return;
  }
  if (!setWebviewUserAgent(wanted)) {
    record(wanted, "unavailable");
    return;
  }
  if (triedBefore(wanted)) {
    // Already set and reloaded once this session, and still not the agent: say so and stop.
    record(wanted, "not-applied");
    return;
  }
  markTried(wanted);
  record(wanted, "set");
  location.reload();
}

applyUserAgentProfile();
