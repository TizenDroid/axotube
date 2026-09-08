// Response-level HQ thumbnails.
//
// Upgrades every video tile's thumbnail array to the hi-res tier set at
// response-parse time (before it reaches the DOM), so all tiles render sharp
// previews without waiting for the focus observer. The focus observer in
// hqThumbnailsFocusObserver.js only handles tiles the response patch missed.

import { configRead } from "../config.js";
import {
  THUMBNAIL_URLS,
  MAX_HQ_CACHE_ENTRIES,
  isVideoThumbnailArray,
} from "../shared/hqThumbnails.js";

const hqThumbnailsCache = {};
const hqThumbnailsCacheOrder = [];

function rememberHqThumbnails(videoID, thumbnails) {
  if (!Object.prototype.hasOwnProperty.call(hqThumbnailsCache, videoID)) {
    hqThumbnailsCacheOrder.push(videoID);
  }
  hqThumbnailsCache[videoID] = thumbnails;
  while (hqThumbnailsCacheOrder.length > MAX_HQ_CACHE_ENTRIES) {
    const oldest = hqThumbnailsCacheOrder.shift();
    delete hqThumbnailsCache[oldest];
  }
}

export function buildHqThumbnails(videoID) {
  const thumbnails = [];
  for (const filename of THUMBNAIL_URLS) {
    thumbnails.push({
      url: `https://i.ytimg.com/vi/${videoID}/${filename}`,
      width: 1280,
      height: 720,
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
  if (!configRead("enableHqThumbnails")) return;
  for (const item of items) {
    if (!item.tileRenderer) continue;

    try {
      const videoID = item.tileRenderer.onSelectCommand?.watchEndpoint?.videoId;
      if (!videoID) continue;

      const primaryThumbnails =
        item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails;
      if (primaryThumbnails === hqThumbnailsCache[videoID]) continue;

      let thumbnails = hqThumbnailsCache[videoID];
      if (!thumbnails) {
        thumbnails = buildHqThumbnails(videoID);
        rememberHqThumbnails(videoID, thumbnails);
      }

      if (item.tileRenderer.header?.tileHeaderRenderer?.thumbnail?.thumbnails) {
        item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = thumbnails;
      }

      if (
        item.tileRenderer.onFocusCommand?.startInlinePlaybackCommand
          ?.playbackEndpoint?.startPlaylistItemEndpoint?.playlistItemData
          ?.thumbnail?.thumbnails
      ) {
        item.tileRenderer.onFocusCommand.startInlinePlaybackCommand.playbackEndpoint.startPlaylistItemEndpoint.playlistItemData.thumbnail.thumbnails = thumbnails;
      }

      if (item.tileRenderer.onFocusCommand) {
        deepSetThumbnails(item.tileRenderer.onFocusCommand, thumbnails);
      }
    } catch (e) {
      console.warn("Error processing thumbnail:", e);
    }
  }
}
