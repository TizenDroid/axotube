import { TileRenderer, ShelfRenderer } from "../ui/ytUI.js";

// Adds the "Queued Videos" shelf to the top of the watch-next pivot when the
// user has queued videos.
export function injectQueuedVideosShelf(pivotContents) {
  if (!window.queuedVideos.videos.length) return;
  const queuedVideosClone = window.queuedVideos.videos.slice();
  queuedVideosClone.unshift(
    TileRenderer("Clear Queue", { customAction: { action: "CLEAR_QUEUE" } }),
  );
  const lastIndex = queuedVideosClone.findIndex(
    (v) => v.contentId === window.queuedVideos.lastVideoId,
  );
  pivotContents.unshift(
    ShelfRenderer("Queued Videos", queuedVideosClone, lastIndex !== -1 ? lastIndex : 0),
  );
}
