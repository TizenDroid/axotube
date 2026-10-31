// Shows the time remaining in place of the elapsed time in the player (e.g. -4:17),
// the way the official apps do. Off by default; the elapsed time is restored when
// it is turned off or the video is live. Ported from VacuumTube's remaining-time.
import { configRead, configChangeEmitter } from "../config.js";
import { getCurrentPlayer, watchVideo } from "../shared/playerLifecycle.js";

// Events that can change the numbers shown. Attached to the video element,
// not the document, so nothing runs while no video is playing.
const VIDEO_EVENTS = ["timeupdate", "durationchange", "ratechange", "seeked", "play", "pause"];

let video = null;
let label = null;
let labelObserver = null;
let showing = false;

function pad(n) {
  return n < 10 ? `0${n}` : String(n);
}

function secondsToTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

function isWatchPage() {
  return /#\/watch/.test(location.hash || "");
}

function findLabel() {
  const elapsed = document.querySelector('[idomkey="time-label"] > [idomkey="elapsedTime"]');
  return elapsed ? elapsed.parentElement : null;
}

function getElapsedTextNode() {
  const node = label ? label.querySelector('[idomkey="elapsedTime"]') : null;
  const text = node ? node.firstChild : null;
  return text && text.nodeType === Node.TEXT_NODE ? text : null;
}

// Youtube re-renders the time label when the controls appear, so it is
// observed and the remaining time is written again whenever that happens.
function setLabel(next) {
  if (next === label) return;
  if (labelObserver) labelObserver.disconnect();
  labelObserver = null;
  label = next;
  showing = false;
  if (label) {
    labelObserver = new MutationObserver(() => render());
    labelObserver.observe(label, { characterData: true, childList: true, subtree: true });
  }
}

function readPlayer(player, method, fallback) {
  try {
    const value = player && typeof player[method] === "function" ? player[method]() : fallback;
    return value === undefined ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

function isLive(player) {
  const data = readPlayer(player, "getVideoData", null);
  return !!(data && data.isLive);
}

function render() {
  const enabled = !!configRead("enableRemainingTime");
  if (!enabled && !showing) return;

  if (!label || !label.parentNode) setLabel(findLabel());
  const node = getElapsedTextNode();
  if (!node) return;

  const player = getCurrentPlayer();
  const active = enabled && !!player && isWatchPage() && !isLive(player);

  if (!active) {
    if (showing) {
      // Put the elapsed time back; YouTube does not render it while controls are hidden.
      const elapsed = Math.floor(readPlayer(player, "getCurrentTime", 0));
      node.data = secondsToTime(elapsed);
    }
    showing = false;
    return;
  }

  const duration = Math.floor(readPlayer(player, "getDuration", 0));
  const elapsed = Math.floor(readPlayer(player, "getCurrentTime", 0));
  const rate = readPlayer(player, "getPlaybackRate", 1) || 1;
  const remaining = Math.round(Math.max(0, (duration - elapsed) / rate)); // speed-adjusted
  const text = `-${secondsToTime(remaining)}`;

  showing = true;
  if (node.data !== text) node.data = text;
}

function attachVideo(next) {
  if (next === video) return;
  if (video) VIDEO_EVENTS.forEach((type) => video.removeEventListener(type, render));
  video = next;
  if (video) VIDEO_EVENTS.forEach((type) => video.addEventListener(type, render));
  render();
}

watchVideo((next) => attachVideo(next));

configChangeEmitter.addEventListener("configChange", (event) => {
  if (event.detail?.key === "enableRemainingTime") render();
});
