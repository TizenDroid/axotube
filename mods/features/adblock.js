/**
 * adblock.js – response filter & patch orchestrator.
 *
 * This module owns the global JSON.parse/JSON.stringify taps. YouTube TV hands
 * every server response to JSON.parse, so this is the single choke point where
 * each feature's response-level transform is applied. Per-feature helpers live
 * in their own modules and are imported here:
 *
 *   - Ad / paid-promo / endscreen / you-there / codec filter  (inline below)
 *   - DeArrow titles + thumbnails  -> ./deArrow.js
 *   - HQ thumbnails                -> ./hqThumbnails.js
 *   - Long-press video menu        -> ./longPressMenu.js
 *   - Inline video previews        -> ./videoPreviews.js
 *   - Hide watched videos          -> ./hideWatchedVideos.js
 *   - SponsorBlock skip buttons    -> inline below
 */
import { configRead } from "../config.js";
import {
  timelyAction,
  ButtonRenderer,
  ShelfRenderer,
  TileRenderer,
} from "../ui/ytUI.js";
import { PatchSettings } from "../ui/customYTSettings.js";
import { t } from "i18next";
import { deArrowify } from "./deArrow.js";
import { hqify } from "./hqThumbnails.js";
import { addLongPress } from "./longPressMenu.js";
import { addPreviews } from "./videoPreviews.js";
import { hideVideo } from "./hideWatchedVideos.js";

/**
 * This is a minimal reimplementation of the following uBlock Origin rule:
 * https://github.com/uBlockOrigin/uAssets/blob/3497eebd440f4871830b9b45af0afc406c6eb593/filters/filters.txt#L116
 */
const origParse = JSON.parse;
JSON.parse = function () {
    const r = origParse.apply(this, arguments);
    try {
      const adBlockEnabled = configRead('enableAdBlock');
      const signinReminderEnabled = configRead('enableSigninReminder');

      if (r.adPlacements && adBlockEnabled) {
      r.adPlacements = [];
    }

    if (r.playerAds && adBlockEnabled) {
      r.playerAds = false;
    }

    if (r.adSlots && adBlockEnabled) {
      r.adSlots = [];
    }

    if (r.paidContentOverlay && !configRead('enablePaidPromotionOverlay')) {
      r.paidContentOverlay = null;
    }

    if (r?.streamingData?.adaptiveFormats && configRead('videoPreferredCodec') !== 'any') {
      const preferredCodec = configRead('videoPreferredCodec');
      const hasPreferredCodec = r.streamingData.adaptiveFormats.find(format => format.mimeType && format.mimeType.includes(preferredCodec));
      if (hasPreferredCodec) {
        r.streamingData.adaptiveFormats = r.streamingData.adaptiveFormats.filter(format => {
          if (format.mimeType && format.mimeType.startsWith('audio/')) return true;
          return format.mimeType && format.mimeType.includes(preferredCodec);
        });
      }
    }

    if (
      r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
        ?.sectionListRenderer?.contents
    ) {
      if (!signinReminderEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
            (elm) => !elm.feedNudgeRenderer
          );
      }

      if (adBlockEnabled) {
        r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents =
          r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents.filter(
            (elm) => !elm.adSlotRenderer
          );

        for (const shelve of r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents) {
          if (shelve.shelfRenderer && shelve.shelfRenderer.content?.horizontalListRenderer?.items) {
            shelve.shelfRenderer.content.horizontalListRenderer.items =
              shelve.shelfRenderer.content.horizontalListRenderer.items.filter(
                (item) => !item.adSlotRenderer
              );
          }
        }
      }

      processShelves(r.contents.tvBrowseRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents);
    }

    if (r.endscreen && configRead('enableHideEndScreenCards')) {
      r.endscreen = null;
    }

    if (r.messages && Array.isArray(r.messages) && !configRead('enableYouThereRenderer')) {
      r.messages = r.messages.filter(
        (msg) => !msg?.youThereRenderer
      );
    }

    if (!Array.isArray(r) && r?.entries && adBlockEnabled) {
      r.entries = r.entries?.filter(
        (elm) => !elm?.command?.reelWatchEndpoint?.adClientParams?.isAd
      );
    }

    if (r?.title?.runs) {
      PatchSettings(r);
    }

    if (r?.contents?.sectionListRenderer?.contents) {
      processShelves(r.contents.sectionListRenderer.contents);
    }

    if (r?.continuationContents?.sectionListContinuation?.contents) {
      processShelves(r.continuationContents.sectionListContinuation.contents);
    }

    if (r?.continuationContents?.horizontalListContinuation?.items) {
      const items = r.continuationContents.horizontalListContinuation.items;
      hqify(items);
      deArrowify(items);
      addLongPress(items);
      r.continuationContents.horizontalListContinuation.items = hideVideo(items);
    }

    if (r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections) {
      for (let i = 0; i < r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections.length; i++) {
        const section = r.contents.tvBrowseRenderer.content.tvSecondaryNavRenderer.sections[i].tvSecondaryNavSectionRenderer;
        if (!section || !section.tabs) continue;
        if (configRead('sortSubscriptionsByAlphabet')) {
          section.tabs.sort((a, b) => {
            const aTitle = a?.tabRenderer?.title;
            const bTitle = b?.tabRenderer?.title;
            if (a.tabRenderer?.selected && !b.tabRenderer?.selected) return -1;
            if (!a.tabRenderer?.selected && b.tabRenderer?.selected) return 1;
            if (aTitle && bTitle) return aTitle.localeCompare(bTitle);
            return 0;
          });
        }
        for (let j = 0; j < section.tabs.length; j++) {
          const tab = section.tabs[j];
          if (tab.tabRenderer.content?.tvSurfaceContentRenderer?.content?.sectionListRenderer?.contents) {
            const index = section.tabs.indexOf(tab);
            const clone = tab.tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents;
            processShelves(clone);
            section.tabs[index].tabRenderer.content.tvSurfaceContentRenderer.content.sectionListRenderer.contents = clone;
          }
        }
      }
    }

    if (r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer) {
      if (!signinReminderEnabled) {
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents =
          r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.filter(
            (elm) => !elm.alertWithActionsRenderer
          );
      }
      processShelves(r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents, false);
      if (window.queuedVideos.videos.length > 0) {
        const queuedVideosClone = window.queuedVideos.videos.slice();
        queuedVideosClone.unshift(TileRenderer(
          'Clear Queue',
          {
            customAction: {
              action: 'CLEAR_QUEUE'
            }
          }));
        r.contents.singleColumnWatchNextResults.pivot.sectionListRenderer.contents.unshift(ShelfRenderer(
          'Queued Videos',
          queuedVideosClone,
          queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId) !== -1 ?
            queuedVideosClone.findIndex(v => v.contentId === window.queuedVideos.lastVideoId)
            : 0
        ));
      }
    }

    /*

    Chapters are disabled due to the API removing description data used to generate chapters
    (see commented version in git history)
    */

    // Manual SponsorBlock Skips
    if (configRead('sponsorBlockManualSkips').length > 0 && r?.playerOverlays?.playerOverlayRenderer) {
      const manualSkippedSegments = configRead('sponsorBlockManualSkips');
      let timelyActions = [];
      if (window?.sponsorblock?.segments) {
        for (const segment of window.sponsorblock.segments) {
          if (manualSkippedSegments.includes(segment.category)) {
            const timelyActionData = timelyAction(
              t('sponsorblock.toasts.skip', { segment: t(`sponsorblock.segments.${segment.category}`) }),
              'SKIP_NEXT',
              {
                clickTrackingParams: null,
                showEngagementPanelEndpoint: {
                  customAction: {
                    action: 'SKIP',
                    parameters: {
                      time: segment.segment[1]
                    }
                  }
                }
              },
              segment.segment[0] * 1000,
              segment.segment[1] * 1000 - segment.segment[0] * 1000
            );
            timelyActions.push(timelyActionData);
          }
        }
        r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = timelyActions;
      }
    } else if (r?.playerOverlays?.playerOverlayRenderer) {
      r.playerOverlays.playerOverlayRenderer.timelyActionRenderers = [];
    }

    if (r?.transportControls?.transportControlsRenderer?.promotedActions && configRead('enableSponsorBlockHighlight')) {
      if (window?.sponsorblock?.segments) {
        const category = window.sponsorblock.segments.find(seg => seg.category === 'poi_highlight');
        if (category) {
          r.transportControls.transportControlsRenderer.promotedActions.push({
            type: 'TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT',
            button: {
              buttonRenderer: ButtonRenderer(
                false,
                t('sponsorblock.toasts.skipToHighlight'),
                'SKIP_NEXT',
                {
                  clickTrackingParams: null,
                  customAction: {
                    action: 'SKIP',
                    parameters: {
                      time: category.segment[0]
                    }
                  }
                })
            }
          });
        }
      }
    }
  } catch (e) {
    console.error('An error occured while processing the JSON:', e);
  }

  return r;
};

// Fix playback issues
const origStringify = JSON.stringify;
JSON.stringify = function (value, replacer, space) {
  const playbackContext = value?.playbackContext?.contentPlaybackContext;
  if (playbackContext && !playbackContext.isInlinePlaybackNoAd) {
    playbackContext.isInlinePlaybackNoAd = true;
    return origStringify.call(this, value, replacer, space);
  }
  return origStringify.call(this, value, replacer, space);
};
window.JSON.stringify = JSON.stringify;
// Patch JSON.parse to use the custom one
window.JSON.parse = JSON.parse;
for (const key in window._yttv) {
  if (
    window._yttv[key] &&
    window._yttv[key].JSON &&
    window._yttv[key].JSON.parse
  ) {
    window._yttv[key].JSON.parse = JSON.parse;
  }
}

// Apply every tile-level transformer to a list of shelves.
function processShelves(shelves, shouldAddPreviews = true) {
  const removeShorts = !configRead("enableShorts");
  const removeAds = configRead("enableAdBlock");
  for (let i = shelves.length - 1; i >= 0; i--) {
    const shelve = shelves[i];
    // Promo shelves (rendered as <ytlr-promo-shelf-renderer>) are
    // promotional content: drop them with the adblock.
    if (
      removeAds &&
      shelve &&
      typeof shelve === "object" &&
      Object.keys(shelve).some((k) => k.toLowerCase().indexOf("promo") !== -1)
    ) {
      shelves.splice(i, 1);
      continue;
    }
    if (!shelve.shelfRenderer) continue;
    if (!shelve.shelfRenderer.content?.horizontalListRenderer?.items) continue;

    // Skip processing entirely for shelves that will be removed
    if (
      removeShorts &&
      shelve.shelfRenderer.tvhtml5ShelfRendererType ===
        "TVHTML5_SHELF_RENDERER_TYPE_SHORTS"
    ) {
      shelves.splice(i, 1);
      continue;
    }

    const items = shelve.shelfRenderer.content.horizontalListRenderer.items;
    hqify(items);
    deArrowify(items);
    addLongPress(items);
    if (shouldAddPreviews) {
      addPreviews(items);
    }
    if (removeShorts) {
      shelve.shelfRenderer.content.horizontalListRenderer.items = items.filter(
        (item) =>
          !item.tileRenderer ||
          (item.tileRenderer.tvhtml5ShelfRendererType !==
            "TVHTML5_TILE_RENDERER_TYPE_SHORTS" &&
            !item.tileRenderer.onSelectCommand?.reelWatchEndpoint),
      );
    }
    shelve.shelfRenderer.content.horizontalListRenderer.items = hideVideo(
      shelve.shelfRenderer.content.horizontalListRenderer.items,
    );
  }
}