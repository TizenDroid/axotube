import { configRead } from "../config.js";
import { getCurrentPlayer, watchVideoId } from "../shared/playerLifecycle.js";
import { debugLog } from "../shared/debugLog.js";

// Turns captions on when a video starts, in the language chosen in settings.
// A manual track in that language is preferred. An auto-generated track is used only when no
// manual one exists and auto-generated is allowed.
//
// A caption track object carries the caption source of one video. A track from another video
// can share a language code with this one, so the track is never reused: it is always taken from
// the list of the video that is playing. It is set once when the video is known, and once more
// when playback starts, because the player can reset it at that point. Captions the viewer
// turned off (an empty track) stay off.

const MAX_ATTEMPTS = 8;
const RETRY_MS = 1000;

let generation = 0;

function baseLanguage(code) {
  return String(code || "").toLowerCase().split("-")[0];
}

export function chooseTrack(tracks, language, allowAuto) {
  const matches = tracks.filter((track) => track && baseLanguage(track.languageCode) === language);
  const manual = matches.find((track) => track.kind !== "asr");
  if (manual) return manual;
  if (allowAuto) return matches.find((track) => track.kind === "asr") || null;
  return null;
}

function describe(track) {
  return track ? (track.languageCode || "?") + "/" + (track.kind || "manual") : "none";
}

function playerVideoId(player) {
  try {
    const data = player && typeof player.getVideoData === "function" ? player.getVideoData() : null;
    return data && data.video_id ? data.video_id : null;
  } catch (e) {
    return null;
  }
}

// "set": a track was set now. "done": nothing to set. "retry": the player is not ready for this
// video yet (it still reports the previous video, or its caption list is not loaded).
// refresh: only put back a track that is already set; never turn captions on.
export function tryEnable(player, videoId, language, allowAuto, refresh) {
  if (!player || typeof player.getOptions !== "function" || typeof player.getOption !== "function") {
    return "retry";
  }
  const reported = playerVideoId(player);
  if (videoId && reported && reported !== videoId) return "retry";
  const options = player.getOptions() || [];
  if (options.indexOf("captions") === -1) return "retry";
  if (typeof player.loadModule === "function") {
    try {
      player.loadModule("captions");
    } catch (e) {}
  }
  const current = player.getOption("captions", "track");
  if (refresh && !(current && current.languageCode)) return "done";
  const tracks = player.getOption("captions", "tracklist") || [];
  if (!tracks.length) return "retry";
  const pick = chooseTrack(tracks, language, allowAuto);
  debugLog("subtitles", refresh ? "refresh" : "set", videoId, "tracks=" + tracks.length, "current=" + describe(current), "pick=" + describe(pick));
  if (!pick) return "done";
  if (typeof player.setOption === "function") player.setOption("captions", "track", pick);
  return "set";
}

function settings() {
  return {
    language: configRead("autoSubtitleLanguage") || "en",
    allowAuto: !!configRead("autoSubtitleAllowAuto"),
  };
}

// Once per video, when playback starts: put the video's own track back if it is set.
function refreshOnPlaybackStart(player, videoId) {
  if (!player || typeof player.addEventListener !== "function") return;
  const refresh = function () {
    try {
      player.removeEventListener("onPlaybackStartExternal", refresh);
    } catch (e) {}
    if (!configRead("enableAutoSubtitles")) return;
    const s = settings();
    tryEnable(player, videoId, s.language, s.allowAuto, true);
  };
  player.addEventListener("onPlaybackStartExternal", refresh);
}

function startForVideo(videoId) {
  const current = ++generation;
  let attempts = 0;
  const step = () => {
    if (current !== generation || !configRead("enableAutoSubtitles")) return;
    const player = getCurrentPlayer();
    const s = settings();
    const result = tryEnable(player, videoId, s.language, s.allowAuto, false);
    attempts += 1;
    if (result === "retry") {
      if (attempts < MAX_ATTEMPTS) setTimeout(step, RETRY_MS);
      return;
    }
    if (result === "set") refreshOnPlaybackStart(player, videoId);
  };
  step();
}

watchVideoId((videoId) => {
  if (videoId) startForVideo(videoId);
});
