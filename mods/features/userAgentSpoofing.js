// The webview's user agent is set to a Samsung TV browser string, the same way
// tizen.websetting.setUserAgentString changes the agent for
// the whole webview, so HTTP requests and navigator.userAgent both carry it.
//
// The standalone splash page applies it first, before anything navigates to
// YouTube. This module is the fallback for a page that loads without the
// splash having run. It reloads at most once per session so the page's own
// requests pick the agent up, and the guard stops any reload loop.

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (SMART-TV; LINUX; Tizen 4.0) AppleWebKit/537.3 (KHTML, like Gecko) SamsungBrowser/2.1 TV Safari/537.3";
const APPLIED_SESSION_KEY = "axotube-user-agent-applied";

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

function applyDefaultUserAgent() {
  if (navigator.userAgent && navigator.userAgent.indexOf("SamsungBrowser/2.1") !== -1) return;
  if (!setWebviewUserAgent(DEFAULT_USER_AGENT)) return;
  try {
    if (sessionStorage.getItem(APPLIED_SESSION_KEY) !== DEFAULT_USER_AGENT) {
      sessionStorage.setItem(APPLIED_SESSION_KEY, DEFAULT_USER_AGENT);
      location.reload();
    }
  } catch (e) {}
}

applyDefaultUserAgent();
