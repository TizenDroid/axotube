// The webview's user agent follows the "userAgentProfile" setting, applied with
// tizen.websetting.setUserAgentString so HTTP requests and navigator.userAgent both
// carry it. Same meaning as the Android app's profiles:
//   "samsung" and "auto" send the Tizen TV agent this app has always used
//   "android" sends a phone agent (experimental: YouTube's TV layout may not suit it)
//
// The standalone splash page applies the TV agent first, before anything navigates to
// YouTube. This module applies the chosen profile on the page itself. It reloads at
// most once per profile per session so the page's own requests pick the agent up,
// and the session guard stops any reload loop.

import { configRead } from "../config.js";

const TV_USER_AGENT =
  "Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.3 (KHTML, like Gecko) SamsungBrowser/2.1 TV Safari/537.3";
const PHONE_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const APPLIED_SESSION_KEY = "axotube-user-agent-applied";

// The agent a profile sends, and a short marker that is in it. A page that already
// reports the marker is left alone, so a navigator string that differs slightly from
// the sent string does not cause a reload.
function agentFor(profile) {
  if (profile === "android") return { ua: PHONE_USER_AGENT, marker: "Pixel 7" };
  return { ua: TV_USER_AGENT, marker: "SamsungBrowser/2.1" };
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

function applyUserAgentProfile() {
  const agent = agentFor(configRead("userAgentProfile"));
  if (navigator.userAgent && navigator.userAgent.indexOf(agent.marker) !== -1) return;
  if (!setWebviewUserAgent(agent.ua)) return;
  try {
    if (sessionStorage.getItem(APPLIED_SESSION_KEY) !== agent.ua) {
      sessionStorage.setItem(APPLIED_SESSION_KEY, agent.ua);
      location.reload();
    }
  } catch (e) {}
}

applyUserAgentProfile();
