// DeArrow – community-approved video titles & thumbnails.
import { configRead } from "../config.js";
import { fetchWithTimeout } from "../shared/fetch.js";
import { createBoundedCache } from "../shared/boundedCache.js";

export const MAX_DEARROW_CACHE_ENTRIES = 256;
const deArrowCache = createBoundedCache(MAX_DEARROW_CACHE_ENTRIES);

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

    const waiter = { item, titlesEnabled, thumbnailsEnabled };
    const cached = deArrowCache.get(videoId);
    if (cached) {
      if (cached.data) {
        applyDeArrow(item, videoId, cached.data, titlesEnabled, thumbnailsEnabled);
      } else if (Array.isArray(cached.waiters)) {
        cached.waiters.push(waiter);
      }
      continue;
    }

    const entry = { data: null, waiters: [waiter] };
    deArrowCache.set(videoId, entry);

    fetchWithTimeout(`https://sponsor.ajay.app/api/branding?videoID=${videoId}`)
      .then((res) => {
        if (!res.ok) throw new Error(`DeArrow HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        entry.data = data;
        const waiters = entry.waiters.slice();
        entry.waiters.length = 0;
        for (const pending of waiters) {
          applyDeArrow(
            pending.item,
            videoId,
            data,
            pending.titlesEnabled,
            pending.thumbnailsEnabled,
          );
        }
      })
      .catch(() => {
        if (deArrowCache.get(videoId) === entry) deArrowCache.delete(videoId);
      });
  }
}

export function resetDeArrowCache(videoID) {
  if (videoID) {
    deArrowCache.delete(videoID);
    return;
  }
  deArrowCache.clear();
}
