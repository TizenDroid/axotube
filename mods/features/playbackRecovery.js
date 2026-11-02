// When YouTube's player shows its error overlay, offer a retry from the same point.
// The blue key reloads the watch page with a start time, so playback resumes where
// it stopped. The overlay is found by its class (.ytp-error), so a YouTube change
// to that class would turn this off, and nothing else.
import { t } from "i18next";
import { showToast } from "../ui/ytUI.js";

const KEY_BLUE = 406;
const CHECK_DELAY_MS = 500;
const ERROR_SELECTOR = ".ytp-error";

let retryArmed = false;
let checkTimer = null;

function currentSeconds() {
  const video = document.querySelector("video");
  if (!video || !isFinite(video.currentTime)) return 0;
  return Math.max(0, Math.floor(video.currentTime));
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m + ":" + (s < 10 ? "0" + s : String(s));
}

// The TV's YouTube keeps its place in the hash, for example #/watch?v=ID. Returns
// that hash with t set to the given seconds, or null when this is not a watch page.
function hashWithStartTime(hash, seconds) {
  const q = hash.indexOf("?");
  if (q === -1 || !/\/watch$/.test(hash.slice(0, q))) return null;
  const parts = hash.slice(q + 1).split("&").filter((part) => part && part.split("=")[0] !== "t");
  parts.push("t=" + seconds);
  return hash.slice(0, q + 1) + parts.join("&");
}

function errorVisible() {
  const el = document.querySelector(ERROR_SELECTOR);
  return !!el && el.offsetWidth > 0 && el.offsetHeight > 0;
}

function arm() {
  if (retryArmed) return;
  retryArmed = true;
  showToast(t("app.name"), t("playback.retryPrompt", { time: formatTime(currentSeconds()) }), null);
}

function retry() {
  retryArmed = false;
  const hash = hashWithStartTime(location.hash, currentSeconds());
  if (hash) location.hash = hash;
  window.location.reload();
}

function checkNow() {
  checkTimer = null;
  if (errorVisible()) arm();
  else retryArmed = false;
}

function scheduleCheck() {
  if (checkTimer === null) checkTimer = setTimeout(checkNow, CHECK_DELAY_MS);
}

function start() {
  if (!document.body) {
    setTimeout(start, 200);
    return;
  }
  new MutationObserver(scheduleCheck).observe(document.body, { childList: true, subtree: true });
}

// A media error on the video element is the same failure from the other side.
document.addEventListener("error", (event) => {
  if (event.target && event.target.tagName === "VIDEO") arm();
}, true);

window.addEventListener("keydown", (event) => {
  if (event.keyCode === KEY_BLUE && retryArmed) {
    event.stopPropagation();
    retry();
  }
}, true);

start();
