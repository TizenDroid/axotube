// On-screen clock. Off by default. clockMode decides when it shows:
//   "always"      on every screen
//   "notPlaying"  only when no video is playing (paused, ended, or not on a video)
import { configRead, configChangeEmitter } from "../config.js";
import { getCurrentPlayer, getCurrentVideo } from "../shared/playerLifecycle.js";
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
let timerSeconds = false;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

// Only the watch page counts as playback. A video preview on a browse page plays in a
// tile, and it is not something the viewer is watching, so it must not hide the clock.
function onWatchRoute() {
  return /#\/watch/.test(window.location.hash || "");
}

function isVideoPlaying() {
  if (!onWatchRoute()) return false;
  // The player's own video, not the first <video> in the page.
  const player = getCurrentPlayer();
  const video = (player && player.querySelector && player.querySelector("video")) || getCurrentVideo();
  return !!(video && !video.paused && !video.ended);
}

function shouldShow() {
  const mode = configRead("clockMode");
  if (mode === "always") return true;
  if (mode === "notPlaying") return !isVideoPlaying();
  return false;
}

function stopTimer() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
}

function msToNextMinute() {
  return 60000 - (Date.now() % 60000) + 50;
}

// With seconds shown the text changes every second. Without them it changes once a minute,
// so the clock waits for the minute instead of repainting every second.
function startTimer(seconds) {
  timerSeconds = seconds;
  timer = setTimeout(tick, seconds ? 1000 : msToNextMinute());
}

function tick() {
  timer = null;
  if (!node) return;
  render();
  startTimer(timerSeconds);
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
  const seconds = !!configRead("clockShowSeconds");
  if (timer !== null && timerSeconds !== seconds) stopTimer();
  if (timer === null) startTimer(seconds);
}

// Playback state changes come as media events, which do not bubble, so listen
// in the capture phase on the document.
["play", "playing", "pause", "ended", "emptied"].forEach((type) => {
  document.addEventListener(type, syncClock, true);
});

// Leaving or entering the watch page changes the answer without a media event.
window.addEventListener("hashchange", () => syncClock());

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
