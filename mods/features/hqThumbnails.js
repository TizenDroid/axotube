// Response-level HQ thumbnails.
//
// Sets every video tile's thumbnail list to the preferred size and the sizes below it,
// at response-parse time (before it reaches the DOM), so tiles render at the chosen
// quality without waiting for the focus observer. The focus observer in
// hqThumbnailsFocusObserver.js only handles tiles the response patch missed.

import {
  buildThumbnailArray,
  createPrefetcher,
  resolveThumbnailQuality,
  MAX_HQ_CACHE_ENTRIES,
  isVideoThumbnailArray,
} from "../shared/hqThumbnails.js";
import { createBoundedCache } from "../shared/boundedCache.js";
import { installThumbnailFallback } from "./thumbnailFallback.js";
import { hqThumbnailMode } from "../shared/performanceMode.js";
import { configRead, configChangeEmitter } from "../config.js";

const hqThumbnailsCache = createBoundedCache(MAX_HQ_CACHE_ENTRIES);
// The browser fetches each new tile's preferred image before the TV asks for it. Created on
// first use, so evaluating this module needs no Image.
let prefetcher = null;
function warmThumbnails(urls) {
  if (!prefetcher) {
    if (typeof Image === "undefined") return;
    prefetcher = createPrefetcher(Image);
  }
  prefetcher.enqueue(urls);
}

// A new preferred size makes every cached tile list wrong.
configChangeEmitter.addEventListener("configChange", (event) => {
  if (event.detail && event.detail.key === "hqThumbnailQuality") hqThumbnailsCache.clear();
});

export function buildHqThumbnails(videoID, preferredId) {
  return buildThumbnailArray(videoID, preferredId);
}


function deepSetThumbnails(obj, thumbnails) {
  if (!obj || typeof obj !== "object") return;
  for (const key in obj) {
    if (key === "thumbnails" && isVideoThumbnailArray(obj[key])) {
      obj[key] = thumbnails;
    } else if (typeof obj[key] === "object") {
      deepSetThumbnails(obj[key], thumbnails);
    }
  }
}

export function hqify(items) {
  // In performance mode the focus observer upgrades only the tile being focused.
  if (hqThumbnailMode() !== "eager") return;
  const preferred = resolveThumbnailQuality(configRead("hqThumbnailQuality"));
  const warm = [];
  for (const item of items) {
    if (!item.tileRenderer) continue;

    try {
      const videoID = item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId;
      if (!videoID) continue;

      const cacheKey = preferred + ":" + videoID;
      const primaryThumbnails = item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails;
      if (primaryThumbnails === hqThumbnailsCache.get(cacheKey)) continue;

      let thumbnails = hqThumbnailsCache.get(cacheKey);
      if (!thumbnails) {
        thumbnails = hqThumbnailsCache.set(cacheKey, buildHqThumbnails(videoID, preferred));
        if (thumbnails && thumbnails.length > 0) warm.push(thumbnails[0].url);
      }

      if (item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails) {
        item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = thumbnails;
      }

      if (
        item.tileRenderer.onFocusCommand?.startInlinePlaybackCommand?.playbackEndpoint
          ?.startPlaylistItemEndpoint?.playlistItemData?.thumbnail?.thumbnails
      ) {
        item.tileRenderer.onFocusCommand.startInlinePlaybackCommand.playbackEndpoint.startPlaylistItemEndpoint.playlistItemData.thumbnail.thumbnails =
          thumbnails;
      }

      if (item.tileRenderer.onFocusCommand) {
        deepSetThumbnails(item.tileRenderer.onFocusCommand, thumbnails);
      }
    } catch (e) {
      console.warn("[AxoTube:hqThumbnails] Error processing thumbnail:", e);
    }
  }
  if (warm.length > 0) warmThumbnails(warm);
}

// Tiles the response did not cover, and images that fail later, step down to a file that exists.
installThumbnailFallback(typeof document !== "undefined" ? document : null);
