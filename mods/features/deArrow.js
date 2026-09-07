// DeArrow – community-approved video titles & thumbnails.
import { configRead, nativeJSONParse, nativeJSONStringify } from "../config.js";
import { fetchWithTimeout } from "../shared/fetch.js";

export const MAX_DEARROW_CACHE_ENTRIES = 256;
const deArrowCache = {};
const deArrowCacheOrder = [];

function putCache(videoId, entry) {
  if (!Object.prototype.hasOwnProperty.call(deArrowCache, videoId)) {
    deArrowCacheOrder.push(videoId);
  }
  deArrowCache[videoId] = entry;
  while (deArrowCacheOrder.length > MAX_DEARROW_CACHE_ENTRIES) {
    const oldest = deArrowCacheOrder.shift();
    delete deArrowCache[oldest];
  }
}

function applyDeArrow(item, videoId, data, titlesEnabled, thumbnailsEnabled) {
  try {
    if (titlesEnabled && data.titles && data.titles.length > 0) {
      const mostVoted = data.titles.reduce((max, title) =>
        max.votes > title.votes ? max : title,
      );
      if (item.tileRenderer?.metadata?.tileMetadataRenderer?.title) {
        item.tileRenderer.metadata.tileMetadataRenderer.title.simpleText = mostVoted.title;
      }
    }

    if (thumbnailsEnabled && data.thumbnails && data.thumbnails.length > 0) {
      const mostVotedThumbnail = data.thumbnails.reduce((max, thumbnail) =>
        max.votes > thumbnail.votes ? max : thumbnail,
      );
      if (
        mostVotedThumbnail.timestamp !== undefined &&
        mostVotedThumbnail.timestamp !== null &&
        Number.isFinite(Number(mostVotedThumbnail.timestamp)) &&
        item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail
      ) {
        item.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails = [
          {
            url: `https://dearrow-thumb.ajay.app/api/v1/getThumbnail?videoID=${videoId}&time=${mostVotedThumbnail.timestamp}`,
            width: 1280,
            height: 640,
          },
        ];
      }
    }
  } catch (e) {
    console.warn("Error processing DeArrow data:", e);
  }
}

export function deArrowify(items) {
  const titlesEnabled = configRead("enableDeArrowTitles");
  const thumbnailsEnabled = configRead("enableDeArrowThumbnails");
  if (!titlesEnabled && !thumbnailsEnabled) return;

  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.adSlotRenderer) {
      items.splice(i, 1);
      continue;
    }
    if (!item.tileRenderer) continue;
    const videoId = item.tileRenderer.contentId;
    if (!videoId) continue;

    const cached = deArrowCache[videoId];
    if (cached) {
      if (cached.data) {
        applyDeArrow(item, videoId, cached.data, titlesEnabled, thumbnailsEnabled);
      }
      continue;
    }

    const promise = fetchWithTimeout(
      `https://sponsor.ajay.app/api/branding?videoID=${videoId}`,
    )
      .then((res) => {
        if (!res.ok) throw new Error(`DeArrow HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        const entry = deArrowCache[videoId];
        if (entry) entry.data = data;
        applyDeArrow(item, videoId, data, titlesEnabled, thumbnailsEnabled);
      })
      .catch(() => {});
    putCache(videoId, promise);
  }
}

export function resetDeArrowCache(videoID) {
  if (videoID) {
    delete deArrowCache[videoID];
    const i = deArrowCacheOrder.indexOf(videoID);
    if (i !== -1) deArrowCacheOrder.splice(i, 1);
    return;
  }
  for (const key in deArrowCache) delete deArrowCache[key];
  deArrowCacheOrder.length = 0;
}

export function deArrowDeepClone(value) {
  return nativeJSONParse(nativeJSONStringify(value));
}
