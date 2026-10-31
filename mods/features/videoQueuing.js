// Video queue. Plays the queued videos one after another when the current one ends.
//
// The state listener follows the live player. playerLifecycle reports each new
// player element (YouTube can replace it during navigation), and the listener is
// moved to the new element. The old element's listener is removed, so a dead
// element is never left holding one.
import resolveCommand from "../resolveCommand.js";
import { watchPlayer } from "../shared/playerLifecycle.js";

window.queuedVideos = {
  videos: [],
  lastVideoId: null,
  currentIndex: -1,
};

function getVideoId(entry) {
  return entry && entry.tileRenderer && entry.tileRenderer.contentId;
}

function playQueueIndex(index) {
  const entry = window.queuedVideos.videos[index];
  const endpoint = entry && entry.tileRenderer && entry.tileRenderer.onSelectCommand;
  if (!endpoint) return false;
  window.queuedVideos.currentIndex = index;
  window.queuedVideos.lastVideoId = getVideoId(entry) || null;
  setTimeout(() => resolveCommand(endpoint), 500);
  return true;
}

function clearQueue() {
  window.queuedVideos.currentIndex = -1;
  window.queuedVideos.lastVideoId = null;
  resolveCommand({ customAction: { action: "CLEAR_QUEUE" } });
}

function handleStateChange(player) {
  const playerStateObject = player.getPlayerStateObject();
  const videoData = player.getVideoData();
  const queue = window.queuedVideos;
  if (queue.videos.length === 0) {
    queue.currentIndex = -1;
    queue.lastVideoId = null;
    return;
  }

  if (playerStateObject.isEnded) {
    let index = queue.currentIndex;
    if (index < 0 || index >= queue.videos.length) {
      index = queue.videos.findIndex((v) => getVideoId(v) === videoData.video_id);
    }

    if (index !== -1) {
      const nextIndex = index + 1;
      if (nextIndex < queue.videos.length && playQueueIndex(nextIndex)) return;
      clearQueue();
      return;
    }

    if (queue.currentIndex + 1 < queue.videos.length && playQueueIndex(queue.currentIndex + 1))
      return;
    if (playQueueIndex(0)) return;
    clearQueue();
    return;
  }

  if (playerStateObject.isPlaying) {
    const container = document.getElementById("container");
    if (container) container.style.setProperty("opacity", "1", "important");

    const current = queue.videos[queue.currentIndex];
    if (getVideoId(current) === videoData.video_id) {
      queue.lastVideoId = videoData.video_id;
      return;
    }

    const match = queue.videos.findIndex((v) => getVideoId(v) === videoData.video_id);
    if (match !== -1) {
      queue.currentIndex = match;
      queue.lastVideoId = videoData.video_id;
    }
  }
}

let attached = null; // { player, listener } for the player that currently has the listener

function attachTo(player) {
  if (attached) {
    attached.player.removeEventListener("onStateChange", attached.listener);
    attached = null;
  }
  if (!player || typeof player.addEventListener !== "function") return;
  const listener = () => handleStateChange(player);
  player.addEventListener("onStateChange", listener);
  attached = { player, listener };
}

watchPlayer(attachTo);
