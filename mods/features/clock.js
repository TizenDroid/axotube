// On-screen clock. Off by default. clockMode decides when it shows:
//   "always"      on every screen
//   "notPlaying"  only when no video is playing (paused, ended, or not on a video)
import { configRead, configChangeEmitter } from "../config.js";
import { getCurrentVideo } from "../shared/playerLifecycle.js";
import { formatClock } from "../shared/clockFormat.js";

const CLOCK_ID = "axo-clock";
const STYLE_ID = "axo-clock-style";
const POSITION_CLASS = {
  topLeft: "axo-clock-top-left",
  topRight: "axo-clock-top-right",
  bottomLeft: "axo-clock-bottom-left",
  bottomRight: "axo-clock-bottom-right",
};
const CSS = `
#${CLOCK_ID} {
  position: fixed;
  z-index: 9000;
  pointer-events: none;
  padding: 3vh 3vw;
  font-family: "YouTube Sans", Roboto, "Noto Sans", Arial, sans-serif;
  font-size: 4vh;
  line-height: 1;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.92);
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.85);
}
#${CLOCK_ID}.axo-clock-top-left { top: 0; left: 0; }
#${CLOCK_ID}.axo-clock-top-right { top: 0; right: 0; }
#${CLOCK_ID}.axo-clock-bottom-left { bottom: 0; left: 0; }
#${CLOCK_ID}.axo-clock-bottom-right { bottom: 0; right: 0; }
`;

let node = null;
let timer = null;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

function isVideoPlaying() {
  const video = getCurrentVideo();
  return !!(video && !video.paused && !video.ended);
}

function shouldShow() {
  const mode = configRead("clockMode");
  if (mode === "always") return true;
  if (mode === "notPlaying") return !isVideoPlaying();
  return false;
}

function stopTimer() {
  if (timer !== null) clearInterval(timer);
  timer = null;
}

function removeNode() {
  stopTimer();
  if (node && node.parentNode) node.parentNode.removeChild(node);
  node = null;
}

function render() {
  if (!node) {
    node = document.createElement("div");
    node.id = CLOCK_ID;
    document.body.appendChild(node);
  }
  const positionClass = POSITION_CLASS[configRead("clockPosition")] || POSITION_CLASS.topRight;
  if (node.className !== positionClass) node.className = positionClass;
  const text = formatClock(
    new Date(),
    configRead("clockFormat"),
    !!configRead("clockShowSeconds"),
  );
  if (node.textContent !== text) node.textContent = text;
}

export function syncClock() {
  if (!document.body) return;
  if (!shouldShow()) {
    removeNode();
    return;
  }
  ensureStyle();
  render();
  // Once a second keeps seconds accurate. Without seconds it still matches the
  // minute within a second, and the cost is one text compare.
  if (timer === null) timer = setInterval(render, 1000);
}

// Playback state changes come as media events, which do not bubble, so listen
// in the capture phase on the document.
["play", "playing", "pause", "ended", "emptied"].forEach((type) => {
  document.addEventListener(type, syncClock, true);
});

configChangeEmitter.addEventListener("configChange", (event) => {
  const key = event.detail && event.detail.key;
  if (key === "clockMode" || key === "clockFormat" || key === "clockPosition" || key === "clockShowSeconds") {
    syncClock();
  }
});

function start() {
  if (!document.body) {
    setTimeout(start, 250);
    return;
  }
  syncClock();
}
start();
