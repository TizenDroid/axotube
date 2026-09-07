// Long-press video menu.
import { configRead, nativeJSONParse, nativeJSONStringify } from "../config.js";
import { longPressData, MenuServiceItemRenderer } from "../ui/ytUI.js";

function makeQueuePayload(item) {
  const src = item.tileRenderer;
  const tile = {};
  if (src.contentType !== undefined) tile.contentType = src.contentType;
  if (src.style !== undefined) tile.style = src.style;
  if (src.contentId !== undefined) tile.contentId = src.contentId;
  if (src.trackingParams !== undefined) tile.trackingParams = src.trackingParams;
  if (src.metadata !== undefined)
    tile.metadata = nativeJSONParse(nativeJSONStringify(src.metadata));
  if (src.header !== undefined)
    tile.header = nativeJSONParse(nativeJSONStringify(src.header));
  if (src.onSelectCommand !== undefined)
    tile.onSelectCommand = nativeJSONParse(nativeJSONStringify(src.onSelectCommand));
  return { tileRenderer: tile };
}

function hasQueueItem(items) {
  return items.some((menuItem) =>
    menuItem?.menuServiceItemRenderer?.serviceEndpoint?.playlistEditEndpoint?.customAction?.action === 'ADD_TO_QUEUE'
  );
}

export function addLongPress(items) {
  if (!configRead("enableLongPress")) return;

  for (const item of items) {
    if (!item.tileRenderer) continue;
    if (item.tileRenderer.style !== 'TILE_STYLE_YTLR_DEFAULT') continue;
    if (!item.tileRenderer.contentId || !item.tileRenderer.onSelectCommand?.watchEndpoint) continue;

    const existingItems = item.tileRenderer.onLongPressCommand?.showMenuCommand?.menu?.menuRenderer?.items;
    if (Array.isArray(existingItems)) {
      if (!hasQueueItem(existingItems)) {
        const copiedItem = makeQueuePayload(item);
        existingItems.push(MenuServiceItemRenderer('Add to Queue', {
          clickTrackingParams: null,
          playlistEditEndpoint: {
            customAction: {
              action: 'ADD_TO_QUEUE',
              parameters: copiedItem
            }
          }
        }));
      }
      continue;
    }

    if (!item.tileRenderer?.metadata?.tileMetadataRenderer) continue;
    if (!item.tileRenderer?.header?.tileHeaderRenderer?.thumbnail?.thumbnails) continue;
    const copiedItem = makeQueuePayload(item);
    const subtitleNode = copiedItem.tileRenderer.metadata.tileMetadataRenderer.lines?.[0]?.lineRenderer?.items?.[0]?.lineItemRenderer?.text;
    if (!subtitleNode) continue;
    const subtitle = subtitleNode.runs?.[0]?.text || subtitleNode.simpleText || '';
    const data = longPressData({
      videoId: copiedItem.tileRenderer.contentId,
      thumbnails: copiedItem.tileRenderer.header.tileHeaderRenderer.thumbnail.thumbnails,
      title: copiedItem.tileRenderer.metadata.tileMetadataRenderer.title?.simpleText || '',
      subtitle,
      watchEndpointData: copiedItem.tileRenderer.onSelectCommand.watchEndpoint,
      item: copiedItem
    });
    item.tileRenderer.onLongPressCommand = data;
  }
}

export { makeQueuePayload };
