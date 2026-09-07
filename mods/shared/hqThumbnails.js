// Shared thumbnail-quality helpers.
import { configRead } from "../config.js";

export const THUMBNAIL_URLS = [
  "maxresdefault.jpg",
  "sddefault.jpg",
  "hqdefault.jpg",
  "mqdefault.jpg",
  "default.jpg",
];

export const MAX_HQ_CACHE_ENTRIES = 256;
export const hqQualityCache = {};
export const hqPendingTesters = {};
const hqCacheOrder = [];

function rememberQuality(videoId, quality) {
  if (!Object.prototype.hasOwnProperty.call(hqQualityCache, videoId)) {
    hqCacheOrder.push(videoId);
  }
  hqQualityCache[videoId] = quality;
  while (hqCacheOrder.length > MAX_HQ_CACHE_ENTRIES) {
    const oldest = hqCacheOrder.shift();
    delete hqQualityCache[oldest];
  }
}

export function extractVideoIdFromThumbnailUrl(url) {
  if (!url || !url.includes("i.ytimg.com/vi/")) return null;
  const match = url.match(/\/vi\/([a-zA-Z0-9_-]+)\//);
  return match ? match[1] : null;
}

export function probeBestThumbnailQuality(videoId, onResult) {
  if (!videoId || typeof onResult !== "function") return;
  const cached = hqQualityCache[videoId];
  if (cached) {
    onResult(cached);
    return;
  }

  if (hqPendingTesters[videoId]) {
    hqPendingTesters[videoId].push(onResult);
    return;
  }

  hqPendingTesters[videoId] = [onResult];
  const finish = (quality) => {
    const waiters = hqPendingTesters[videoId] || [];
    delete hqPendingTesters[videoId];
    rememberQuality(videoId, quality);
    waiters.forEach((cb) => {
      try { cb(quality); } catch (e) {}
    });
  };

  const tester = new Image();
  tester.onload = function () {
    if (this.naturalWidth === 120 && this.naturalHeight === 90) {
      finish("hqdefault.jpg");
    } else {
      finish("maxresdefault.jpg");
    }
  };
  tester.onerror = function () {
    finish("hqdefault.jpg");
  };
  tester.src = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}

export function isVideoThumbnailArray(thumbnails) {
  return (
    Array.isArray(thumbnails) &&
    thumbnails.length > 0 &&
    thumbnails[0].width &&
    thumbnails[0].width > 100
  );
}

export function isHqThumbnailsEnabled() {
  return configRead("enableHqThumbnails");
}
