// The red key opens the standalone app's diagnostics page on the proxy. It does
// nothing in the normal Tizen module, where there is no proxy to ask.
const KEY_RED = 403;

function proxyBase() {
  if (window.__axotubeProxyUrl) return window.__axotubeProxyUrl;
  if (location.port === "8081") return location.protocol + "//" + location.hostname + ":8081";
  return null;
}

window.addEventListener("keydown", (event) => {
  if (event.keyCode !== KEY_RED) return;
  const base = proxyBase();
  if (!base) return;
  event.stopPropagation();
  location.href = base + "/axotube/diagnostics";
}, true);
