// axotube Subtitle Localization Mod
// Automatically adds user's local language to subtitle auto-translate menu if not present

import { configRead } from "../config.js";
import languages from "../translations/language-names.js";

const LANGUAGE_CODES = [
  "af", "sq", "am", "ar", "hy", "as", "az", "eu", "be", "bn", "bs", "bg", "my", "ca",
  "zh-CN", "zh-TW", "zh-HK", "hr", "cs", "da", "nl", "en", "et", "fil", "fi", "fr", "gl",
  "ka", "de", "el", "gu", "he", "hi", "hu", "is", "id", "ga", "it", "ja", "kn", "kk", "km",
  "ko", "ky", "lo", "lv", "lt", "mk", "ms", "ml", "mt", "mr", "mn", "ne", "no", "or", "fa",
  "pl", "pt", "pa", "ro", "ru", "sr", "si", "sk", "sl", "es", "sw", "sv", "ta", "te", "th",
  "tr", "uk", "ur", "uz", "vi", "cy", "yi", "yo", "zu",
];

export function getComprehensiveLanguageList() {
  try {
    const map = {};
    LANGUAGE_CODES.forEach((code) => {
      if (code.includes("-")) {
        const [lang, region] = code.split("-");
        const languageName = languages.language.standard.long[lang] || code;
        const regionName = languages.region.long[region] || region;
        map[code] = `${languageName} (${regionName})`;
      } else {
        map[code] = languages.language.standard.long[code] || code;
      }
    });
    return map;
  } catch (e) {
    const fallback = {};
    LANGUAGE_CODES.forEach((c) => (fallback[c] = c));
    return fallback;
  }
}

export function getCountryLanguage(countryCode) {
  if (!countryCode) return null;
  try {
    const region = String(countryCode).toUpperCase();
    const zhRegionMap = { CN: "zh-CN", TW: "zh-TW", HK: "zh-HK", SG: "zh-CN" };
    if (zhRegionMap[region]) {
      const code = zhRegionMap[region];
      const name = languages.language.standard.long[code] || code;
      return { code, name };
    }
    const base = new Intl.Locale("und", { region });
    const maximized = base.maximize ? base.maximize() : base;
    const lang = maximized.language || "en";
    return { code: lang, name: languages.language.standard.long[lang] || lang };
  } catch (e) {
    console.warn("axotube Subtitle Localization: Could not infer language for country", countryCode, e);
    return null;
  }
}

let isPatched = false;

function getUserCountryCode() {
  try {
    if (window.yt && window.yt.config_ && window.yt.config_.GL) return window.yt.config_.GL;
    console.warn("axotube Subtitle Localization: Could not determine user country code");
    return null;
  } catch (error) {
    console.error("axotube Subtitle Localization: Error getting country code:", error);
    return null;
  }
}

function languageExistsInMenu(items, languageCode, languageName) {
  return items.some((item) => {
    const commands = item.compactLinkRenderer?.serviceEndpoint?.commandExecutorCommand?.commands;
    const translationLang = commands?.[0]?.selectSubtitlesTrackCommand?.translationLanguage;
    return !!(
      translationLang &&
      (translationLang.languageCode === languageCode || translationLang.languageName === languageName)
    );
  });
}

function createLanguageOption(languageCode, languageName) {
  return {
    compactLinkRenderer: {
      title: { simpleText: languageName },
      serviceEndpoint: {
        commandExecutorCommand: {
          commands: [
            { selectSubtitlesTrackCommand: { translationLanguage: { languageCode, languageName } } },
            { openClientOverlayAction: { type: "CLIENT_OVERLAY_TYPE_CAPTIONS_LANGUAGE", updateAction: true } },
            { signalAction: { signal: "POPUP_BACK" } },
          ],
        },
      },
      secondaryIcon: { iconType: "RADIO_BUTTON_UNCHECKED" },
    },
  };
}

function getExistingLanguages(items) {
  const existingLanguages = new Set();
  items.forEach((item) => {
    const commands = item.compactLinkRenderer?.serviceEndpoint?.commandExecutorCommand?.commands;
    const translationLang = commands?.[0]?.selectSubtitlesTrackCommand?.translationLanguage;
    if (translationLang) {
      existingLanguages.add(translationLang.languageCode);
      existingLanguages.add(translationLang.languageName);
    }
  });
  return existingLanguages;
}

function createSectionTitle(title) {
  return {
    overlayMessageRenderer: {
      title: { simpleText: "" },
      subtitle: { simpleText: title },
      style: "OVERLAY_MESSAGE_STYLE_SUBSECTION_TITLE",
    },
  };
}

function patchSubtitleMenu() {
  if (isPatched) return true;
  if (!document.querySelector(".html5-video-player") || !window._yttv) return false;

  const yttvInstance = Object.values(window._yttv).find(
    (obj) => obj && obj.instance && typeof obj.instance.resolveCommand === "function",
  );
  if (!yttvInstance) return false;
  if (yttvInstance.instance.resolveCommand.isPatchedBySubtitleLocalization) {
    isPatched = true;
    return true;
  }

  const originalResolveCommand = yttvInstance.instance.resolveCommand;
  yttvInstance.instance.resolveCommand = function (cmd, _) {
    if (cmd?.openPopupAction?.uniqueId === "CLIENT_OVERLAY_TYPE_CAPTIONS_AUTO_TRANSLATE") {
      const showUserLanguage = configRead("enableShowUserLanguage");
      const showOtherLanguages = configRead("enableShowOtherLanguages");
      if (!showUserLanguage && !showOtherLanguages) {
        return originalResolveCommand.apply(this, arguments);
      }

      const items = cmd.openPopupAction?.popup?.overlaySectionRenderer?.overlay
        ?.overlayTwoPanelRenderer?.actionPanel?.overlayPanelRenderer?.content
        ?.overlayPanelItemListRenderer?.items;
      if (!Array.isArray(items)) return originalResolveCommand.apply(this, arguments);

      const existingLanguages = getExistingLanguages(items);
      if (showUserLanguage) {
        const userCountryCode = getUserCountryCode();
        const userLanguage = getCountryLanguage(userCountryCode);
        if (userLanguage && !languageExistsInMenu(items, userLanguage.code, userLanguage.name)) {
          const userLanguageOption = createLanguageOption(userLanguage.code, userLanguage.name);
          const recommendedIndex = items.findIndex(
            (item) => item.overlayMessageRenderer?.subtitle?.simpleText === "Recommended languages",
          );
          if (recommendedIndex > -1) {
            items.splice(recommendedIndex + 1, 0, userLanguageOption);
          } else {
            const otherLanguagesIndex = items.findIndex(
              (item) => item.overlayMessageRenderer?.subtitle?.simpleText === "Other languages",
            );
            if (otherLanguagesIndex > -1) items.splice(otherLanguagesIndex, 0, userLanguageOption);
            else items.unshift(userLanguageOption);
          }
          existingLanguages.add(userLanguage.code);
          existingLanguages.add(userLanguage.name);
        }
      }

      if (showOtherLanguages) {
        const missingLanguages = Object.entries(getComprehensiveLanguageList())
          .filter(([code, name]) => !existingLanguages.has(code) && !existingLanguages.has(name))
          .sort(([, a], [, b]) => a.localeCompare(b));
        if (missingLanguages.length > 0) {
          items.push(createSectionTitle("Other Languages"));
          missingLanguages.forEach(([code, name]) => items.push(createLanguageOption(code, name)));
        }
      }
    }
    return originalResolveCommand.apply(this, arguments);
  };

  yttvInstance.instance.resolveCommand.isPatchedBySubtitleLocalization = true;
  isPatched = true;
  return true;
}

let subtitlePollCount = 0;
let subtitlePollTimer = null;
const SUBTITLE_POLL_LIMIT = 30;
const SUBTITLE_POLL_DELAY_MS = 500;

function attemptSubtitlePatch() {
  if (isPatched) return;
  subtitlePollCount += 1;
  if (patchSubtitleMenu()) return;
  if (subtitlePollCount >= SUBTITLE_POLL_LIMIT) {
    console.warn("axotube Subtitle Localization: resolveCommand did not become ready in time.");
    return;
  }
  subtitlePollTimer = setTimeout(attemptSubtitlePatch, SUBTITLE_POLL_DELAY_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attemptSubtitlePatch);
} else {
  attemptSubtitlePatch();
}
