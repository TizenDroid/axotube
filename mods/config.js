const CONFIG_KEY = "ytaf-configuration";

// Capture native JSON before the adblock.js patch replaces JSON.parse/stringify.
const nativeJSONParse = JSON.parse;
const nativeJSONStringify = JSON.stringify;
const clone = (value) => nativeJSONParse(nativeJSONStringify(value));

const defaultConfig = {
  enableAdBlock: true,
  enableSponsorBlock: true,
  enableSponsorBlockToasts: true,
  sponsorBlockManualSkips: ["intro", "outro", "filler"],
  enableSponsorBlockSponsor: true,
  enableSponsorBlockIntro: true,
  enableSponsorBlockOutro: true,
  enableSponsorBlockInteraction: true,
  enableSponsorBlockSelfPromo: true,
  enableSponsorBlockPreview: true,
  enableSponsorBlockMusicOfftopic: true,
  enableSponsorBlockFiller: false,
  enableSponsorBlockHighlight: true,
  videoSpeed: 1,
  preferredVideoQuality: "auto",
  enableDeArrowTitles: true,
  enableDeArrowThumbnails: true,
  routeColor: "#0f0f0f",
  routeBackgroundUrl: "",
  themePreset: "default",
  textTheme: "default",
  enableFixedUI: window.h5vcc && window.h5vcc.tizentube ? false : true,
  enableHqThumbnails: true,
  enableLongPress: true,
  enableShorts: true,
  dontCheckUpdateUntil: 0,
  enableWhoIsWatchingMenu: false,
  permanentlyEnableWhoIsWatchingMenu: false,
  enableWhosWatchingMenuOnAppExit: false,
  enableShowUserLanguage: true,
  enableShowOtherLanguages: false,
  showWelcomeToast: true,
  enablePreviousNextButtons: true,
  enableSuperThanksButton: false,
  enableSpeedControlsButton: true,
  enablePatchingVideoPlayer: true,
  enableMPButton: true,
  enableSwapMPWithPIP: false,
  enablePreviews: true,
  enableHideWatchedVideos: false,
  hideWatchedVideosThreshold: 80,
  hideWatchedVideosPages: [],
  enableHideEndScreenCards: false,
  enableYouThereRenderer: true,
  enableScreenDimming: false,
  dimmingTimeout: 60,
  dimmingOpacity: 0.5,
  enablePaidPromotionOverlay: true,
  speedSettingsIncrement: 0.25,
  videoPreferredCodec: "any",
  launchToOnStartup: null,
  reloadHomeOnStartup: true,
  disabledSidebarContents: [],
  disableChannelsOnSidebar: false,
  enableUpdater: true,
  autoFrameRate: false,
  autoFrameRatePauseVideoFor: 0,
  enableSigninReminder: false,
  sortSubscriptionsByAlphabet: false,
  enableReducedMotion: false,
};

const CONFIG_RANGES = {
  videoSpeed: [0.05, 5],
  hideWatchedVideosThreshold: [0, 100],
  dimmingTimeout: [1, 3600],
  dimmingOpacity: [0, 1],
  speedSettingsIncrement: [0.01, 1],
  autoFrameRatePauseVideoFor: [0, 10000],
  dontCheckUpdateUntil: [0, Number.MAX_SAFE_INTEGER],
};

export function validateConfigValue(key, value) {
  if (!Object.prototype.hasOwnProperty.call(defaultConfig, key)) return false;
  const expected = defaultConfig[key];

  if (expected === null) {
    // launchToOnStartup is stored by the TV settings UI as a serialized command.
    return value === null || typeof value === "string";
  }
  if (Array.isArray(expected)) return Array.isArray(value);
  if (typeof expected === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    const range = CONFIG_RANGES[key];
    return !range || (value >= range[0] && value <= range[1]);
  }
  return typeof value === typeof expected;
}

let localConfig;

function initConfig() {
  localConfig = clone(defaultConfig);
  try {
    if (!window.localStorage || !window.localStorage[CONFIG_KEY]) return;
    const parsed = nativeJSONParse(window.localStorage[CONFIG_KEY]);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    Object.keys(parsed).forEach((key) => {
      if (validateConfigValue(key, parsed[key])) {
        localConfig[key] = clone(parsed[key]);
      }
    });
  } catch (err) {
    console.warn("Config read failed; using defaults:", err);
  }
}

initConfig();

function tryPersistConfig() {
  try {
    if (!window.localStorage) return false;
    const serialized = nativeJSONStringify(localConfig);
    window.localStorage[CONFIG_KEY] = serialized;
    return true;
  } catch (err) {
    if (err.name === "QuotaExceededError") {
      console.warn("localStorage quota exceeded; replacing axotube config only");
      try {
        if (typeof window.localStorage.removeItem === "function") {
          window.localStorage.removeItem(CONFIG_KEY);
        } else {
          delete window.localStorage[CONFIG_KEY];
        }
        window.localStorage[CONFIG_KEY] = nativeJSONStringify(localConfig);
        return true;
      } catch (e2) {
        console.error("Failed to persist axotube config:", e2);
        return false;
      }
    }
    console.error("Failed to persist config:", err);
    return false;
  }
}

export function configRead(key) {
  if (!Object.prototype.hasOwnProperty.call(defaultConfig, key)) {
    console.warn("Unknown config key", key);
    return undefined;
  }
  if (!validateConfigValue(key, localConfig[key])) {
    localConfig[key] = clone(defaultConfig[key]);
  }
  return localConfig[key];
}

export function configWrite(key, value) {
  if (!validateConfigValue(key, value)) {
    console.warn("Rejected invalid config value", key, value);
    return false;
  }
  localConfig[key] = clone(value);
  const persisted = tryPersistConfig();
  configChangeEmitter.dispatchEvent(
    new CustomEvent("configChange", { detail: { key, value: clone(value) } }),
  );
  return persisted;
}

export const configChangeEmitter = new EventTarget();

export function configSnapshot() {
  return clone(localConfig);
}

export { nativeJSONParse, nativeJSONStringify };
