// Hold the native YouTube TV splash screen (the #loader with the YouTube logo)
// on screen until axotube has finished initializing (ui.js execute_once_dom_loaded).
// The app removes #loader itself when its UI mounts; we snapshot its computed
// style into our own fixed overlay so the user never sees a flash of unpatched UI.

let held = false;
let overlay = null;
let grabbed = false;
let observer = null;

function release() {
  if (!held) return;
  held = false;
  if (observer) {
    try {
      observer.disconnect();
    } catch (e) {
      /* noop */
    }
    observer = null;
  }
  if (overlay && overlay.parentNode) {
    overlay.parentNode.removeChild(overlay);
  }
  overlay = null;
}

window.__releaseBootLoader = release;

// Never hold the loader longer than this in case init never completes.
setTimeout(() => {
  if (observer) {
    try {
      observer.disconnect();
    } catch (e) {
      /* noop */
    }
    observer = null;
  }
  release();
}, 10000);

function grab() {
  if (held || grabbed) return;
  if (!document.getElementById) return;

  const loader = document.getElementById("loader");
  if (!loader) return;

  let cs;
  try {
    cs = window.getComputedStyle(loader);
  } catch (e) {
    cs = null;
  }

  overlay = document.createElement("div");
  overlay.id = "ytaf-boot-overlay";
  const bgColor = (cs && cs.backgroundColor) || "rgb(40, 40, 40)";
  const bgImage = (cs && cs.backgroundImage) || "none";
  overlay.style.cssText =
    "position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;" +
    "background-color:" +
    bgColor +
    ";" +
    "background-image:" +
    bgImage +
    ";" +
    "background-position:" +
    ((cs && cs.backgroundPosition) || "center center") +
    ";" +
    "background-repeat:" +
    ((cs && cs.backgroundRepeat) || "no-repeat") +
    ";" +
    "background-size:" +
    ((cs && cs.backgroundSize) || "60%") +
    ";";
  (document.body || document.documentElement).appendChild(overlay);
  held = true;
  grabbed = true;
}

function watch() {
  if (grabbed || !document.documentElement) return;

  // Catch #loader the instant it is parsed (fast, reliable at document-start).
  try {
    observer = new MutationObserver(() => {
      grab();
      if (grabbed && observer) observer.disconnect();
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  } catch (e) {
    // MutationObserver unavailable: fall back to polling.
  }

  // Immediate + a few retries to cover cases where the loader exists already
  // but its styles (computed background) are not ready yet.
  grab();
  setTimeout(grab, 50);
  setTimeout(grab, 200);
  setTimeout(grab, 800);
  setTimeout(grab, 2000);
}

(function start() {
  if (document.documentElement) {
    watch();
  } else {
    document.addEventListener("DOMContentLoaded", watch);
  }
})();
