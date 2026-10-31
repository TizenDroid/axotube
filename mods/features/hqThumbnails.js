// Response-level HQ thumbnails.
//
// Upgrades every video tile's thumbnail array to the hi-res tier set at
// response-parse time (before it reaches the DOM), so all tiles render sharp
// previews without waiting for the focus observer. The focus observer in
// hqThumbnailsFocusObserver.js only handles tiles the response patch missed.

import {
  THUMBNAIL_URLS,
  THUMBNAIL_SIZES,
  MAX_HQ_CACHE_ENTRIES,
  isVideoThumbnailArray,
} from "../shared/hqThumbnails.js";
import { createBoundedCache } from "../shared/boundedCache.js";
import { hqThumbnailMode } from "../shared/performanceMode.js";

const hqThumbnailsCache = createBoundedCache(MAX_HQ_CACHE_ENTRIES);

export function buildHqThumbnails(videoID) {
  const thumbnails = [];
  for (const filename of THUMBNAIL_URLS) {
    const size = THUMBNAIL_SIZES[filename];
    thumbnails.push({
      url: `https://i.ytimg.com/vi/${videoID}/${filename}`,
      width: size.width,
      height: size.height,
    });
  }
  return thumbnails;
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
  for (const item of items) {
    if (!item.tileRenderer) continue;

    try {
      const videoID = item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId;
      if (!videoID) continue;

      const primaryThumbnails = item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails;
      if (primaryThumbnails === hqThumbnailsCache.get(videoID)) continue;

      let thumbnails = hqThumbnailsCache.get(videoID);
      if (!thumbnails) {
        thumbnails = hqThumbnailsCache.set(videoID, buildHqThumbnails(videoID));
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
}
