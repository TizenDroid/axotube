// Shared thumbnail-quality helpers.
import { configRead } from "../config.js";
import { createBoundedCache } from "./boundedCache.js";

export const THUMBNAIL_URLS = [
  "maxresdefault.jpg",
  "sddefault.jpg",
  "hqdefault.jpg",
  "mqdefault.jpg",
  "default.jpg",
];

// True pixel sizes of each YouTube thumbnail file. Advertising every entry as
// 1280x720 made the largest look like the right choice for every tile size.
export const THUMBNAIL_SIZES = {
  "maxresdefault.jpg": { width: 1280, height: 720 },
  "sddefault.jpg": { width: 640, height: 480 },
  "hqdefault.jpg": { width: 480, height: 360 },
  "mqdefault.jpg": { width: 320, height: 180 },
  "default.jpg": { width: 120, height: 90 },
};

export const MAX_HQ_CACHE_ENTRIES = 256;
export const hqQualityCache = createBoundedCache(MAX_HQ_CACHE_ENTRIES);
// videoId -> callbacks waiting on an in-flight quality probe.
export const hqPendingTesters = new Map();

export function extractVideoIdFromThumbnailUrl(url) {
  if (!url || !url.includes("i.ytimg.com/vi/")) return null;
  const match = url.match(/\/vi\/([a-zA-Z0-9_-]+)\//);
  return match ? match[1] : null;
}

export function probeBestThumbnailQuality(videoId, onResult) {
  if (!videoId || typeof onResult !== "function") return;
  const cached = hqQualityCache.get(videoId);
  if (cached) {
    onResult(cached);
    return;
  }

  if (hqPendingTesters.has(videoId)) {
    hqPendingTesters.get(videoId).push(onResult);
    return;
  }

  hqPendingTesters.set(videoId, [onResult]);
  const finish = (quality) => {
    const waiters = hqPendingTesters.get(videoId) || [];
    hqPendingTesters.delete(videoId);
    hqQualityCache.set(videoId, quality);
    waiters.forEach((cb) => {
      try { cb(quality); } catch (e) {}
    });
  };

  const probe = (quality, fallback) => {
    const tester = new Image();
    tester.onload = function () {
      const isPlaceholder = this.naturalWidth === 120 && this.naturalHeight === 90;
      if (isPlaceholder) fallback();
      else finish(quality);
    };
    tester.onerror = fallback;
    tester.src = `https://i.ytimg.com/vi/${videoId}/${quality}`;
  };

  probe("maxresdefault.jpg", () => {
    probe("sddefault.jpg", () => finish("hqdefault.jpg"));
  });
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
