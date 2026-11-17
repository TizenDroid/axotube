/**
 * adblock.js – response filter orchestrator.
 *
 * This file only decides which feature runs on each response, in a fixed
 * order. The logic lives in the modules it imports:
 *
 *   ads/rules.js            recognition rules (pure)
 *   ads/responseAds.js      top-level ad fields and browse ad slots
 *   ads/player.js           player attestation / ad-break tracking
 *   ads/shelves.js          shelf and item processing, empty-shelf cleanup
 *   ads/fallback.js         bounded search for ad keys on large responses
 *   ads/breaker.js          per-section error isolation
 *   ads/stats.js            counters and debug-only logging
 *   telemetry/endpoints.js  telemetry URL rules
 *   telemetry/hooks.js      XHR / fetch / beacon hooks
 *   streamFormats.js        preferred video codec
 *   playerNotices.js        paid promo, end screens, you-there, sign-in prompts
 *   sponsorBlockActions.js  SponsorBlock skip buttons
 *   queuedVideosShelf.js    queued videos shelf
 *   playbackContextStringify.js  JSON.stringify playback fix
 *
 * Guide filtering is registered alongside these filters in the response pipeline.
 */
import { configRead } from "../config.js";
import { PatchSettings } from "../ui/customYTSettings.js";
import { filterGuideItems } from "../ui/customGuideAction.js";
import { filterAvatarQuality } from "./avatarQuality.js";
import { installResponsePipeline } from "../shared/responsePipeline.js";
import { hasKnownTopLevelKey, textMayHaveAds } from "./ads/rules.js";
import { runGuarded } from "./ads/breaker.js";
import { bump, debugLog } from "./ads/stats.js";
import { applyTopLevelAdFields, removeBrowseAdSlots } from "./ads/responseAds.js";
import { stripPlayerTracking } from "./ads/player.js";
import { processShelves, decorateItems } from "./ads/shelves.js";
import { boundedAdSearch, FALLBACK_MIN_TEXT_LENGTH } from "./ads/fallback.js";
import { applyStreamFormatFilter } from "./streamFormats.js";
import { applyPlayerNotices, applySigninPromptFilter } from "./playerNotices.js";
import { applySponsorBlockActions } from "./sponsorBlockActions.js";
import { injectQueuedVideosShelf } from "./queuedVideosShelf.js";
import { installPlaybackStringifyFix } from "./playbackContextStringify.js";
import { installTelemetryHooks } from "./telemetry/hooks.js";

// Settings are read once per response, not once per section.
function readFlags() {
  return {
    adBlock: !!configRead("enableAdBlock"),
    signin: !!configRead("enableSigninReminder"),
    paidPromo: !!configRead("enablePaidPromotionOverlay"),
    hideEndScreens: !!configRead("enableHideEndScreenCards"),
    youThere: !!configRead("enableYouThereRenderer"),
    shorts: !!configRead("enableShorts"),
    sortSubscriptions: !!configRead("sortSubscriptionsByAlphabet"),
    preferredCodec: configRead("videoPreferredCodec"),
    // Player ad tracking follows the ad blocker: it is not a separate setting in the TV menu.
    blockPlayerTracking: !!configRead("enableAdBlock") && configRead("blockPlayerAdTracking") !== false,
    removeLiveVideos: !!configRead("removeLiveVideos"),
    removeTopLiveGames: !!configRead("removeTopLiveGames"),
    removeMostRelevant: !!configRead("removeMostRelevant"),
    sponsorManualSkips: configRead("sponsorBlockManualSkips"),
    sponsorHighlight: !!configRead("enableSponsorBlockHighlight"),
  };
}

function shelfOptions(flags, adsOn, previews) {
  return {
    removeAds: adsOn,
    removeShorts: !flags.shorts,
    addPreviews: previews,
    optional: {
      live: flags.removeLiveVideos,
      topLiveGames: flags.removeTopLiveGames,
      mostRelevant: flags.removeMostRelevant,
    },
  };
}

function sortSecondaryNavTabs(tabs) {
  tabs.sort((a, b) => {
    const aTitle = a?.tabRenderer?.title;
    const bTitle = b?.tabRenderer?.title;
    if (a.tabRenderer?.selected && !b.tabRenderer?.selected) return -1;
    if (!a.tabRenderer?.selected && b.tabRenderer?.selected) return 1;
    if (aTitle && bTitle) return aTitle.localeCompare(bTitle);
    return 0;
  });
}

function filterYoutubeResponse(r, text) {
  if (!hasKnownTopLevelKey(r)) return;

  const flags = readFlags();
  // The text pre-scan skips ad work for responses that cannot contain ad structures.
  const scanAds = textMayHaveAds(text);
  const adsOn = flags.adBlock && scanAds;

  if (adsOn) runGuarded("topLevelAds", () => applyTopLevelAdFields(r));
  if (scanAds && flags.blockPlayerTracking) {
    runGuarded("playerTracking", () => stripPlayerTracking(r));
  }
  runGuarded("streamFormats", () => applyStreamFormatFilter(r, flags.preferredCodec));
  runGuarded("playerNotices", () => applyPlayerNotices(r, flags));

  const browseList = r?.contents?.tvBrowseRenderer?.content?.tvSurfaceContentRenderer?.content
    ?.sectionListRenderer;
  if (browseList?.contents) {
    runGuarded("browse", () => {
      browseList.contents = applySigninPromptFilter(browseList.contents, "feedNudgeRenderer", flags);
      if (adsOn) browseList.contents = removeBrowseAdSlots(browseList.contents);
      processShelves(browseList.contents, shelfOptions(flags, adsOn, true));
    });
  }

  if (r?.title?.runs) PatchSettings(r);

  if (r?.contents?.sectionListRenderer?.contents) {
    runGuarded("sectionList", () =>
      processShelves(r.contents.sectionListRenderer.contents, shelfOptions(flags, adsOn, true)),
    );
  }

  if (r?.continuationContents?.sectionListContinuation?.contents) {
    runGuarded("sectionContinuation", () =>
      processShelves(
        r.continuationContents.sectionListContinuation.contents,
        shelfOptions(flags, adsOn, true),
      ),
    );
  }

  if (r?.continuationContents?.horizontalListContinuation?.items) {
    runGuarded("horizontalContinuation", () => {
      const list = r.continuationContents.horizontalListContinuation;
      list.items = decorateItems(list.items, false);
    });
  }

  const secondaryNav = r?.contents?.tvBrowseRenderer?.content?.tvSecondaryNavRenderer?.sections;
  if (secondaryNav) {
    runGuarded("secondaryNav", () => {
      for (let i = 0; i < secondaryNav.length; i++) {
        const section = secondaryNav[i].tvSecondaryNavSectionRenderer;
        if (!section || !section.tabs) continue;
        if (flags.sortSubscriptions) sortSecondaryNavTabs(section.tabs);
        for (let j = 0; j < section.tabs.length; j++) {
          const tab = section.tabs[j];
          const surface = tab.tabRenderer.content?.tvSurfaceContentRenderer?.content;
          if (surface?.sectionListRenderer?.contents) {
            processShelves(surface.sectionListRenderer.contents, shelfOptions(flags, adsOn, true));
          }
        }
      }
    });
  }

  const watchNext = r?.contents?.singleColumnWatchNextResults?.pivot?.sectionListRenderer;
  if (watchNext) {
    runGuarded("watchNext", () => {
      watchNext.contents = applySigninPromptFilter(watchNext.contents, "alertWithActionsRenderer", flags);
      processShelves(watchNext.contents, shelfOptions(flags, adsOn, false));
      injectQueuedVideosShelf(watchNext.contents);
    });
  }

  /*
    Chapters are disabled due to the API removing description data used to generate chapters
    (see commented version in git history)
    */

  runGuarded("sponsorBlock", () => applySponsorBlockActions(r, flags));

  // Last step: the marker text is still present, so the large-response search
  // runs for keys the known paths did not catch. Everything it finds is a miss
  // to report.
  if (adsOn && typeof text === "string" && text.length >= FALLBACK_MIN_TEXT_LENGTH) {
    runGuarded("fallback", () => {
      const result = boundedAdSearch(r, { player: flags.blockPlayerTracking });
      if (result.removed) {
        bump("knownPathMiss", result.removed);
        bump("fallbackRemoved", result.removed);
        debugLog("fallback removed", result.removed, "entries from", result.nodes, "nodes");
      }
    });
  }
}

installTelemetryHooks(typeof window !== "undefined" ? window : null);
installResponsePipeline([filterYoutubeResponse, filterGuideItems, filterAvatarQuality]);
installPlaybackStringifyFix();
