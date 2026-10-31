import { configRead } from "../config.js";
import { getCurrentPlayer, watchVideoId } from "../shared/playerLifecycle.js";

// Turns captions on when a video starts, in the language chosen in settings.
// A manual track in that language is preferred. An auto-generated track is used
// only when no manual one exists and auto-generated is allowed. The decision is
// made once per video, so turning captions off stays off for that video.

const MAX_ATTEMPTS = 8;
const RETRY_MS = 1000;

let generation = 0;

function baseLanguage(code) {
  return String(code || "").toLowerCase().split("-")[0];
}

function chooseTrack(tracks, language, allowAuto) {
  const matches = tracks.filter((track) => track && baseLanguage(track.languageCode) === language);
  const manual = matches.find((track) => track.kind !== "asr");
  if (manual) return manual;
  if (allowAuto) return matches.find((track) => track.kind === "asr") || null;
  return null;
}

// "done": the decision is made, or there is nothing to do.
// "retry": the player or its caption list is not ready yet.
function tryEnable(player, language, allowAuto) {
  if (!player || typeof player.getOptions !== "function" || typeof player.getOption !== "function") {
    return "retry";
  }
  const options = player.getOptions() || [];
  if (options.indexOf("captions") === -1) return "retry";
  if (typeof player.loadModule === "function") {
    try {
      player.loadModule("captions");
    } catch (e) {}
  }
  const current = player.getOption("captions", "track");
  if (current && current.languageCode) return "done";
  const tracks = player.getOption("captions", "tracklist") || [];
  if (!tracks.length) return "retry";
  const pick = chooseTrack(tracks, language, allowAuto);
  if (pick && typeof player.setOption === "function") {
    player.setOption("captions", "track", pick);
  }
  return "done";
}

function startForVideo() {
  const current = ++generation;
  let attempts = 0;
  const step = () => {
    if (current !== generation || !configRead("enableAutoSubtitles")) return;
    const result = tryEnable(
      getCurrentPlayer(),
      configRead("autoSubtitleLanguage") || "en",
      !!configRead("autoSubtitleAllowAuto"),
    );
    attempts += 1;
    if (result === "retry" && attempts < MAX_ATTEMPTS) setTimeout(step, RETRY_MS);
  };
  step();
}

watchVideoId((videoId) => {
  if (videoId) startForVideo();
});

export { chooseTrack, tryEnable };
