import { configRead } from "../config.js";
import { getCurrentPlayer, watchVideoId } from "../shared/playerLifecycle.js";

// Turns captions on when a video starts, in the language chosen in settings.
// A manual track in that language is preferred. An auto-generated track is used only when no
// manual one exists and auto-generated is allowed.
//
// Three things make this reliable:
//  - It decides only once the player reports this video's id. Before that, the caption list
//    and the current track still belong to the previous video.
//  - It checks once more after the video has started, because the player can reset the track
//    as playback begins. If the track is now another video's, it is replaced.
//  - An empty track means captions are off. That is respected, so turning them off stays off.

const MAX_ATTEMPTS = 8;
const RETRY_MS = 1000;
const VERIFY_MS = 2000;
const MAX_SETS = 4;

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

function sameTrack(a, b) {
  return (
    !!a &&
    !!b &&
    a.languageCode === b.languageCode &&
    (a.kind || "") === (b.kind || "") &&
    (a.vssId || "") === (b.vssId || "")
  );
}

function playerVideoId(player) {
  try {
    const data = player && typeof player.getVideoData === "function" ? player.getVideoData() : null;
    return data && data.video_id ? data.video_id : null;
  } catch (e) {
    return null;
  }
}

// "set": a track was set now. "done": the right track is in place, or there is nothing to set.
// "retry": the player or its caption list for this video is not ready yet.
export function tryEnable(player, videoId, language, allowAuto, verifying) {
  if (!player || typeof player.getOptions !== "function" || typeof player.getOption !== "function") {
    return "retry";
  }
  // Until the player reports this video, its caption list and track are the previous video's.
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
  // Captions turned off (an empty track) are left off once the video is playing.
  if (verifying && !(current && current.languageCode)) return "done";
  const tracks = player.getOption("captions", "tracklist") || [];
  if (!tracks.length) return "retry";
  // A track this video offers was chosen already (by the user, or by an earlier check): kept.
  // Any other track is the previous video's, and is replaced.
  if (current && current.languageCode && tracks.some((track) => sameTrack(track, current))) return "done";
  const pick = chooseTrack(tracks, language, allowAuto);
  if (!pick) return "done";
  if (sameTrack(current, pick)) return "done";
  if (typeof player.setOption === "function") player.setOption("captions", "track", pick);
  return "set";
}

function startForVideo(videoId) {
  const current = ++generation;
  let attempts = 0;
  let sets = 0;
  const enabled = () => current === generation && !!configRead("enableAutoSubtitles");
  const attempt = (verifying) =>
    tryEnable(
      getCurrentPlayer(),
      videoId,
      configRead("autoSubtitleLanguage") || "en",
      !!configRead("autoSubtitleAllowAuto"),
      verifying,
    );

  const step = () => {
    if (!enabled()) return;
    const result = attempt(false);
    attempts += 1;
    if (result === "retry") {
      if (attempts < MAX_ATTEMPTS) setTimeout(step, RETRY_MS);
      return;
    }
    if (result === "set" && sets + 1 < MAX_SETS) {
      sets += 1;
      setTimeout(verify, VERIFY_MS);
    }
  };

  const verify = () => {
    if (!enabled()) return;
    const result = attempt(true);
    if (result === "set" && sets + 1 < MAX_SETS) {
      sets += 1;
      setTimeout(verify, VERIFY_MS);
    }
  };

  step();
}

watchVideoId((videoId) => {
  if (videoId) startForVideo(videoId);
});
