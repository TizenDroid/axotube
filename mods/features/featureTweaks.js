// Silent feature-flag tweaks. Writes live-used tectonicConfig feature switch
// values so YouTube TV behaves the way axotube wants, without exposing a
// settings entry for each one. Everything here is a no-op when the config
// object hasn't materialised yet (the module retries a few times).
//
// Read live via window.tectonicConfig.featureSwitches (see main.js _.D()). We:
//   1. Make sure disallowUnifiedFlagAccess is false (protected/Nka flags like
//      abortPendingPageRequests would otherwise throw when read).
//   2. Enable Premium HBR playback quality support.
//   3. Abort stale in-flight navigation requests when leaving a page.
//   4. Suppress premium-lite upsells / premium page deeplinks.
//   5. Disable ad/telemetry/reporting switches that this build reads.
//   6. Flip commonly-consumed UX switches (captions persistence, one-click
//      seek, grid watch next, ...) that other chunks likely read.
import { configChangeEmitter } from "../config.js";

const tweaks = {
  enablePremiumHbrSupport: true,
  abortPendingPageRequests: true,
  enableWebGlobalConfigHotConfig: false,

  // Premium-lite upsells / deeplink surfaced to free users' UI.
  enablePremiumLiteUpsellLr: false,
  enablePremiumPageDeeplink: false,
  premiumLiteUpsellMaxTimesSeen: Number.MAX_SAFE_INTEGER,
  premiumLiteUpsellSeenRecentlyDays: 9999,
  premiumLiteUpsellSerializedParams: "",

  // Ad + telemetry/logging switches this bundle reads via featureSwitches.
  // Kept silent: these exist as either w-map/d-map entries here or are likely
  // read inside other chunks (player/watch/search) that ship separately.
  enableIfaReporting: false,
  enableIfaEncryption: false,
  enableAdsClientLogging: false,
  enableNetworkMonitoringUnified: false,
  enableHiddenVisibilityLogging: false,
  enableCobaltMetrics: false,
  enableCobaltRequestHistograms: false,
  enableCobaltHttpCache: false,
  enableCobaltHttpCacheLogging: false,
  reportAuthCredentialIntervalSeconds: 0,

  // Plausible-other-chunk flags. main.js never reads these directly (map +
  // defaults snapshot only, hence "dead" inside this single bundle), but the
  // player/watch/search/settings chunks shipped separately likely consume
  // them via the same _.D() mechanism. Cheap to set, harmless if unread.
  oneClickSeek: "on",
  enableSkipPreviousButton5sThreshold: true,
  enableCaptionsPersistence: true,
  enableKabukiCaptionPersistence: true,
  enableGridWatchNext: true,
  enableNavLoadOnRightArrow: true,
  enableRenderSingleSearchBar: true,
  lazyLoadingAlgorithm: 0,
  enableNewAudioSettingsMenu: true,
  enableDirectEntryToShortsClient: true,
  enableYtlrKeyboardForSearch: true,
  enablePostPlayMode: true,
  enablePaidTosViewer: true,
  useReduxForPlayerStyles: true,
};

function apply() {
  try {
    if (
      typeof window === "undefined" ||
      !window.tectonicConfig ||
      typeof window.tectonicConfig.featureSwitches !== "object"
    ) {
      return false;
    }

    window.tectonicConfig.disallowUnifiedFlagAccess = false;
    Object.assign(window.tectonicConfig.featureSwitches, tweaks);
    return true;
  } catch (err) {
    return false;
  }
}

// Fire once config exists, retrying in case the config loads late. The first
// apply is enough; afterwards the values stay (hot re-merge is disabled by
// enableWebGlobalConfigHotConfig=false which we also enforce here).
const RETRY_ATTEMPTS = 50;
const RETRY_DELAY_MS = 200;
let retries = 0;

function tryApply() {
  if (apply()) return;
  retries += 1;
  if (retries >= RETRY_ATTEMPTS) return;
  setTimeout(tryApply, RETRY_DELAY_MS);
}

tryApply();

// Any later config change (e.g. remote web-config edit) re-applies the silent
// tweaks so a stray push can't flip them back.
configChangeEmitter.addEventListener("configChange", () => {
  apply();
});
