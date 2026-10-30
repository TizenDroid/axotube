import { nativeHost } from "../shared/nativeHost.js";
import AXOTUBE_VERSION from "../version.js";
import { t } from "i18next";
import configSchema from "../../config-schema.json";
import { configRead } from "../config.js";
import { writeClientSetting } from "../shared/clientSettings.js";
import { generateQRCode } from "./qrCode.js";
import {
  showModal,
  buttonItem,
  overlayPanelItemListRenderer,
  overlayMessageRenderer,
  QrCodeRenderer,
} from "./ytUI.js";

// The settings tree is plain data: labels, config keys and nesting. It is
// rendered as YouTube's own modal panels. Node kinds:
//   value: "<key>"          toggle bound to a boolean config key
//   key + value             radio choice for a string or number config key
//   arrayToEdit: "<key>"    multi-select over an array config key
//   stepper: <step>         numeric stepper bound to value (range from schema)
//   segment: "<type>"       SponsorBlock segment type: skip automatically,
//                           show a skip button, or off (cycles on press)
//   options: [...]          submenu
//   options: { title, subtitle, content }   information panel (text, { qrLink })
//   action: "<ACTION>"      runs a custom action
// A null entry is left out. That is how a feature the device lacks is hidden.

// Each segment type has one enable key. Whether it is shown as a skip button
// (listed in sponsorBlockManualSkips) is a separate flag, so the mode is derived
// from both.
const SEGMENT_TYPES = [
  { type: "sponsor", key: "enableSponsorBlockSponsor", icon: "MONEY_HEART" },
  { type: "intro", key: "enableSponsorBlockIntro", icon: "PLAY_CIRCLE" },
  { type: "outro", key: "enableSponsorBlockOutro", icon: "STOP_CIRCLE" },
  { type: "interaction", key: "enableSponsorBlockInteraction", icon: "TOUCH_APP" },
  { type: "selfpromo", key: "enableSponsorBlockSelfPromo", icon: "PROMOTION" },
  { type: "preview", key: "enableSponsorBlockPreview", icon: "PREVIEW" },
  { type: "filler", key: "enableSponsorBlockFiller", icon: "PADDING" },
  { type: "music_offtopic", key: "enableSponsorBlockMusicOfftopic", icon: "MUSIC_NOTE" },
];

const SEGMENT_NEXT_MODE = { skip: "show", show: "off", off: "skip" };

const PRESET_NAMES = [
  "default",
  "black",
  "darkGray",
  "charcoal",
  "navy",
  "darkRed",
  "darkGreen",
  "darkPurple",
];
const TEXT_THEMES = ["default", "white", "gray", "red", "blue", "green", "purple", "yellow"];
const QUALITIES = ["auto", "2160p", "1440p", "1080p", "720p", "480p", "360p", "240p", "144p"];
const CODECS = ["any", "vp9", "av01", "avc1"];
const SUBTITLE_LANGUAGES = ["en", "hi", "es", "fr", "de", "pt", "ja", "ko", "ru"];
const EXPERIMENTAL_RESOLUTIONS = ["1440p", "2160p"];
const SPEED_STEPS = [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5];
const PAUSE_SECONDS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const WATCHED_THRESHOLDS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const DIM_TIMEOUTS = [10, 20, 30, 60, 120, 180, 240, 300];
const DIM_OPACITIES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

// YouTube section names are shown as YouTube spells them, so they stay untranslated.
const SIDEBAR_ITEMS = [
  { name: "Search", icon: "SEARCH" },
  { name: "Home", icon: "WHAT_TO_WATCH" },
  { name: "Sports", icon: "TROPHY" },
  { name: "News", icon: "NEWS" },
  { name: "Music", icon: "YOUTUBE_MUSIC" },
  { name: "Podcasts", icon: "BROADCAST" },
  { name: "Movies & TV", icon: "CLAPPERBOARD" },
  { name: "Live", icon: "LIVE" },
  { name: "Gaming", icon: "GAMING" },
  { name: "Subscriptions", icon: "SUBSCRIPTIONS" },
  { name: "Library", icon: "TAB_LIBRARY" },
  { name: "More", icon: "TAB_MORE" },
];

function browseValue(browseId) {
  return JSON.stringify({ browseEndpoint: { browseId } });
}

const STARTUP_PAGES = [
  { name: "Search", icon: "SEARCH", value: JSON.stringify({ searchEndpoint: { query: "" } }) },
  { name: "Home", icon: "WHAT_TO_WATCH", value: browseValue("FEtopics") },
  { name: "Sports", icon: "TROPHY", value: browseValue("FEtopics_sports") },
  { name: "News", icon: "NEWS", value: browseValue("FEtopics_news") },
  { name: "Music", icon: "YOUTUBE_MUSIC", value: browseValue("FEtopics_music") },
  { name: "Podcasts", icon: "BROADCAST", value: browseValue("FEtopics_podcasts") },
  { name: "Movies & TV", icon: "CLAPPERBOARD", value: browseValue("FEtopics_movies") },
  { name: "Gaming", icon: "GAMING", value: browseValue("FEtopics_gaming") },
  { name: "Live", icon: "LIVE", value: browseValue("FEtopics_live") },
  { name: "Subscriptions", icon: "SUBSCRIPTIONS", value: browseValue("FEsubscriptions") },
  { name: "Library", icon: "TAB_LIBRARY", value: browseValue("FElibrary") },
  { name: "More", icon: "TAB_MORE", value: browseValue("FEtopics_more") },
];

// What a segment type does right now: off, a skip button, or skipped automatically.
function segmentMode(type) {
  const entry = segmentEntry(type);
  if (!entry || !configRead(entry.key)) return "off";
  const manual = configRead("sponsorBlockManualSkips") || [];
  return manual.indexOf(type) !== -1 ? "show" : "skip";
}

function segmentEntry(type) {
  for (let i = 0; i < SEGMENT_TYPES.length; i++) {
    if (SEGMENT_TYPES[i].type === type) return SEGMENT_TYPES[i];
  }
  return null;
}

// Writes only the keys that need to change. An array write toggles membership,
// so it is sent only when the type's membership is wrong.
function writeSegmentMode(type, mode) {
  const entry = segmentEntry(type);
  if (!entry) return;
  const wantEnabled = mode !== "off";
  if (!!configRead(entry.key) !== wantEnabled) {
    writeClientSetting(entry.key, "boolValue", wantEnabled);
  }
  const manual = configRead("sponsorBlockManualSkips") || [];
  const isManual = manual.indexOf(type) !== -1;
  if (isManual !== (mode === "show")) {
    writeClientSetting("sponsorBlockManualSkips", "arrayValue", type);
  }
}

function toggle(name, key, icon) {
  return { name, icon, value: key };
}

function radio(name, key, value) {
  return { name, key, value };
}

function submenu(name, icon, options, menuHeader) {
  return { name, icon, value: null, menuHeader, options };
}

function heading(title, subtitle) {
  return { title, subtitle };
}

function aboutLink(name, link) {
  return {
    name,
    icon: "OPEN_IN_NEW",
    value: null,
    options: {
      title: name,
      subtitle: link,
      content: [t("settings.about.scanMessage", { name }), { qrLink: link }],
    },
  };
}

// The frame-rate row needs the TV's native frame-rate call.
function frameRateSupported() {
  const host = nativeHost();
  return !!(host && host.SetFrameRate);
}

export function buildSettingsTree() {
  const settings = [
    submenu(
      t("settings.ads.title"),
      "MONEY_HAND",
      [
        toggle(t("settings.ads.blockAds"), "enableAdBlock", "DOLLAR_SIGN"),
        toggle(t("settings.ads.paidPromotion"), "enablePaidPromotionOverlay"),
        toggle(t("settings.ads.sponsorBlock"), "enableSponsorBlock", "MONEY_HAND"),
        submenu(
          t("settings.ads.segmentTypes.title"),
          "SETTINGS",
          SEGMENT_TYPES.map((entry) => ({
            name: t(`settings.ads.segments.${entry.type}`),
            icon: entry.icon,
            segment: entry.type,
          })),
          heading(t("settings.ads.segmentTypes.title"), t("settings.ads.segmentTypes.subtitle")),
        ),
        toggle(t("settings.ads.highlightButton"), "enableSponsorBlockHighlight"),
        toggle(t("settings.ads.notices"), "enableSponsorBlockToasts"),
      ],
      heading(t("settings.ads.title"), t("settings.ads.subtitle")),
    ),
    submenu(
      t("settings.playback.title"),
      "PLAY_CIRCLE",
      [
        submenu(
          t("settings.playback.quality.title"),
          "VIDEO_QUALITY",
          QUALITIES.map((quality) =>
            radio(
              quality === "auto" ? t("settings.common.auto") : quality,
              "preferredVideoQuality",
              quality,
            ),
          ),
          heading(t("settings.playback.quality.title"), t("settings.playback.quality.subtitle")),
        ),
        submenu(
          t("settings.playback.codec.title"),
          "VIDEO_QUALITY",
          CODECS.map((codec) =>
            radio(
              codec === "any" ? t("settings.common.any") : codec.toUpperCase(),
              "videoPreferredCodec",
              codec,
            ),
          ),
          heading(t("settings.playback.codec.title"), t("settings.playback.codec.subtitle")),
        ),
        submenu(
          t("settings.playback.speedStep.title"),
          "SLOW_MOTION_VIDEO",
          SPEED_STEPS.map((step) => radio(`${step}x`, "speedSettingsIncrement", step)),
          heading(
            t("settings.playback.speedStep.title"),
            t("settings.playback.speedStep.subtitle"),
          ),
        ),
        frameRateSupported()
          ? submenu(
              t("settings.playback.frameRate.title"),
              "SLOW_MOTION_VIDEO",
              [
                toggle(t("settings.playback.frameRate.match"), "autoFrameRate"),
                submenu(
                  t("settings.playback.frameRate.pause.title"),
                  "TIMER",
                  PAUSE_SECONDS.map((seconds) =>
                    radio(secondsLabel(seconds), "autoFrameRatePauseVideoFor", seconds * 1000),
                  ),
                  heading(
                    t("settings.playback.frameRate.pause.title"),
                    t("settings.playback.frameRate.pause.subtitle"),
                  ),
                ),
              ],
              heading(
                t("settings.playback.frameRate.title"),
                t("settings.playback.frameRate.subtitle"),
              ),
            )
          : null,
        submenu(
          t("settings.playback.captions.title"),
          "TRANSLATE",
          [
            toggle(t("settings.playback.captions.onByDefault"), "enableAutoSubtitles"),
            submenu(
              t("settings.playback.captions.language.title"),
              "TRANSLATE",
              SUBTITLE_LANGUAGES.map((code) =>
                radio(t(`settings.playback.languages.${code}`), "autoSubtitleLanguage", code),
              ),
              heading(
                t("settings.playback.captions.language.title"),
                t("settings.playback.captions.language.subtitle"),
              ),
            ),
            toggle(t("settings.playback.captions.allowAuto"), "autoSubtitleAllowAuto"),
            toggle(t("settings.playback.captions.myLanguage"), "enableShowUserLanguage"),
            toggle(t("settings.playback.captions.otherLanguages"), "enableShowOtherLanguages"),
          ],
          heading(t("settings.playback.captions.title"), t("settings.playback.captions.subtitle")),
        ),
        submenu(
          t("settings.playback.experimental.title"),
          "VIDEO_QUALITY",
          [
            toggle(t("settings.playback.experimental.unlock"), "enableExperimentalResolution"),
            submenu(
              t("settings.playback.experimental.max.title"),
              "VIDEO_QUALITY",
              EXPERIMENTAL_RESOLUTIONS.map((res) => radio(res, "experimentalMaxResolution", res)),
              heading(
                t("settings.playback.experimental.max.title"),
                t("settings.playback.experimental.max.subtitle"),
              ),
            ),
          ],
          heading(
            t("settings.playback.experimental.title"),
            t("settings.playback.experimental.subtitle"),
          ),
        ),
        submenu(
          t("settings.playback.panelShrink.title"),
          "PICTURE_IN_PICTURE",
          [
            toggle(t("settings.playback.panelShrink.on"), "enablePanelShrink"),
            submenu(
              t("settings.playback.panelShrink.size.title"),
              "VIDEO_QUALITY",
              [
                radio("50%", "panelShrinkPercent", "50"),
                radio("60%", "panelShrinkPercent", "60"),
                radio("70%", "panelShrinkPercent", "70"),
              ],
              heading(
                t("settings.playback.panelShrink.size.title"),
                t("settings.playback.panelShrink.size.subtitle"),
              ),
            ),
          ],
          heading(
            t("settings.playback.panelShrink.title"),
            t("settings.playback.panelShrink.subtitle"),
          ),
        ),
        toggle(t("settings.playback.pauseInBackground"), "enablePauseOnBlur"),
        toggle(t("settings.playback.remainingTime"), "enableRemainingTime"),
      ],
      heading(t("settings.playback.title"), t("settings.playback.subtitle")),
    ),
    submenu(
      t("settings.playerControls.title"),
      "VIDEO_YOUTUBE",
      [
        toggle(t("settings.playerControls.customize"), "enablePatchingVideoPlayer"),
        toggle(t("settings.playerControls.previousNext"), "enablePreviousNextButtons", "SKIP_NEXT"),
        toggle(
          t("settings.playerControls.speed"),
          "enableSpeedControlsButton",
          "SLOW_MOTION_VIDEO",
        ),
        toggle(t("settings.playerControls.superThanks"), "enableSuperThanksButton", "MONEY_HEART"),
        toggle(t("settings.playerControls.miniPlayer"), "enableMPButton"),
        toggle(
          t("settings.playerControls.pipInsteadOfMini"),
          "enableSwapMPWithPIP",
          "PICTURE_IN_PICTURE",
        ),
        toggle(t("settings.playerControls.onePress"), "enableOnePressMode"),
      ],
      heading(t("settings.playerControls.title"), t("settings.playerControls.subtitle")),
    ),
    submenu(
      t("settings.browsing.title"),
      "TV",
      [
        submenu(
          t("settings.browsing.thumbnails.title"),
          "VIDEO_QUALITY",
          [
            toggle(t("settings.browsing.hqThumbnails"), "enableHqThumbnails"),
            toggle(t("settings.browsing.deArrowTitles"), "enableDeArrowTitles"),
            toggle(t("settings.browsing.deArrowThumbnails"), "enableDeArrowThumbnails"),
            toggle(t("settings.browsing.deArrowPeek"), "enableDeArrowPeek"),
          ],
          heading(
            t("settings.browsing.thumbnails.title"),
            t("settings.browsing.thumbnails.subtitle"),
          ),
        ),
        submenu(
          t("settings.browsing.previews.title"),
          "PREVIEW",
          [
            toggle(t("settings.browsing.previews.on"), "enablePreviews"),
            {
              name: t("settings.browsing.previews.length"),
              icon: "TIMER",
              value: "previewLengthSeconds",
              stepper: 5,
            },
          ],
          heading(t("settings.browsing.previews.title"), t("settings.browsing.previews.subtitle")),
        ),
        submenu(
          t("settings.browsing.hideWatched.title"),
          "VISIBILITY_OFF",
          [
            toggle(t("settings.browsing.hideWatched.on"), "enableHideWatchedVideos"),
            submenu(
              t("settings.browsing.hideWatched.threshold.title"),
              "TIMER",
              WATCHED_THRESHOLDS.map((percent) =>
                radio(`${percent}%`, "hideWatchedVideosThreshold", percent),
              ),
              heading(
                t("settings.browsing.hideWatched.threshold.title"),
                t("settings.browsing.hideWatched.threshold.subtitle"),
              ),
            ),
            {
              name: t("settings.browsing.hideWatched.pages.title"),
              value: null,
              arrayToEdit: "hideWatchedVideosPages",
              menuHeader: heading(
                t("settings.browsing.hideWatched.pages.title"),
                t("settings.browsing.hideWatched.pages.subtitle"),
              ),
              options: [
                { name: "Search Results", value: "search" },
                { name: "Home", value: "home" },
                { name: "Music", value: "music" },
                { name: "Gaming", value: "gaming" },
                { name: "Subscriptions", value: "subscriptions" },
                { name: "Library", value: "library" },
                { name: "More", value: "more" },
              ],
            },
          ],
          heading(
            t("settings.browsing.hideWatched.title"),
            t("settings.browsing.hideWatched.subtitle"),
          ),
        ),
        toggle(t("settings.browsing.shorts"), "enableShorts", "YOUTUBE_SHORTS_FILL_24"),
        toggle(t("settings.browsing.endScreens"), "enableHideEndScreenCards", "VISIBILITY_OFF"),
        toggle(t("settings.browsing.longPress"), "enableLongPress", "TOUCH_APP"),
        toggle(t("settings.browsing.stillWatching"), "enableYouThereRenderer"),
      ],
      heading(t("settings.browsing.title"), t("settings.browsing.subtitle")),
    ),
    submenu(
      t("settings.home.title"),
      "MENU",
      [
        submenu(
          t("settings.home.startup.title"),
          "TV",
          STARTUP_PAGES.map((page) => ({
            name: page.name,
            icon: page.icon,
            key: "launchToOnStartup",
            value: page.value,
          })),
          heading(t("settings.home.startup.title"), t("settings.home.startup.subtitle")),
        ),
        toggle(t("settings.home.reloadHome"), "reloadHomeOnStartup"),
        {
          name: t("settings.home.sidebarItems.title"),
          icon: "MENU",
          value: null,
          arrayToEdit: "disabledSidebarContents",
          menuHeader: heading(
            t("settings.home.sidebarItems.title"),
            t("settings.home.sidebarItems.subtitle"),
          ),
          options: SIDEBAR_ITEMS.map((item) => ({
            name: item.name,
            icon: item.icon,
            value: item.icon,
          })),
        },
        toggle(t("settings.home.hideChannels"), "disableChannelsOnSidebar"),
        toggle(t("settings.home.sortSubscriptions"), "sortSubscriptionsByAlphabet"),
      ],
      heading(t("settings.home.title"), t("settings.home.subtitle")),
    ),
    submenu(
      t("settings.appearance.title"),
      "STYLE",
      [
        submenu(
          t("settings.appearance.theme.title"),
          "COLOR_LENS",
          [
            submenu(
              t("settings.appearance.theme.presets.title"),
              "COLOR_LENS",
              PRESET_NAMES.map((name) =>
                radio(t(`settings.appearance.colors.${name}`), "themePreset", name),
              ),
              heading(
                t("settings.appearance.theme.presets.title"),
                t("settings.appearance.theme.presets.subtitle"),
              ),
            ),
            submenu(
              t("settings.appearance.theme.background.title"),
              "COLOR_LENS",
              PRESET_NAMES.map((name) =>
                radio(
                  t(`settings.appearance.colors.${name}`),
                  "routeColor",
                  configSchema.themePresetColors[name],
                ),
              ),
              heading(
                t("settings.appearance.theme.background.title"),
                t("settings.appearance.theme.background.subtitle"),
              ),
            ),
            submenu(
              t("settings.appearance.theme.text.title"),
              "COLOR_LENS",
              TEXT_THEMES.map((name) =>
                radio(t(`settings.appearance.textColors.${name}`), "textTheme", name),
              ),
              heading(
                t("settings.appearance.theme.text.title"),
                t("settings.appearance.theme.text.subtitle"),
              ),
            ),
          ],
          heading(t("settings.appearance.theme.title"), t("settings.appearance.theme.subtitle")),
        ),
        submenu(
          t("settings.appearance.dimming.title"),
          "EYE_OFF",
          [
            toggle(t("settings.appearance.dimming.on"), "enableScreenDimming", "EYE_OFF"),
            submenu(
              t("settings.appearance.dimming.timeout.title"),
              "TIMER",
              DIM_TIMEOUTS.map((seconds) => radio(dimLabel(seconds), "dimmingTimeout", seconds)),
              heading(
                t("settings.appearance.dimming.timeout.title"),
                t("settings.appearance.dimming.timeout.subtitle"),
              ),
            ),
            submenu(
              t("settings.appearance.dimming.opacity.title"),
              "LENS_BLUE",
              DIM_OPACITIES.map((opacity) =>
                radio(`${Math.round(opacity * 100)}%`, "dimmingOpacity", opacity),
              ),
              heading(
                t("settings.appearance.dimming.opacity.title"),
                t("settings.appearance.dimming.opacity.subtitle"),
              ),
            ),
          ],
          heading(
            t("settings.appearance.dimming.title"),
            t("settings.appearance.dimming.subtitle"),
          ),
        ),
        toggle(t("settings.appearance.performance"), "enablePerformanceMode", "SETTINGS"),
        submenu(
          t("settings.appearance.clock.title"),
          "TIMER",
          [
            submenu(
              t("settings.appearance.clock.show.title"),
              "VISIBILITY",
              [
                radio(t("settings.appearance.clock.show.off"), "clockMode", "off"),
                radio(t("settings.appearance.clock.show.always"), "clockMode", "always"),
                radio(
                  t("settings.appearance.clock.show.notPlaying"),
                  "clockMode",
                  "notPlaying",
                ),
              ],
              heading(
                t("settings.appearance.clock.show.title"),
                t("settings.appearance.clock.show.subtitle"),
              ),
            ),
            submenu(
              t("settings.appearance.clock.format.title"),
              "TIMER",
              [
                radio(t("settings.appearance.clock.format.h24"), "clockFormat", "24h"),
                radio(t("settings.appearance.clock.format.h12"), "clockFormat", "12h"),
                radio(
                  t("settings.appearance.clock.format.h12NoAmPm"),
                  "clockFormat",
                  "12hNoAmPm",
                ),
              ],
              heading(
                t("settings.appearance.clock.format.title"),
                t("settings.appearance.clock.format.subtitle"),
              ),
            ),
            submenu(
              t("settings.appearance.clock.position.title"),
              "TV",
              [
                radio(t("settings.appearance.clock.position.topLeft"), "clockPosition", "topLeft"),
                radio(t("settings.appearance.clock.position.topRight"), "clockPosition", "topRight"),
                radio(
                  t("settings.appearance.clock.position.bottomLeft"),
                  "clockPosition",
                  "bottomLeft",
                ),
                radio(
                  t("settings.appearance.clock.position.bottomRight"),
                  "clockPosition",
                  "bottomRight",
                ),
              ],
              heading(
                t("settings.appearance.clock.position.title"),
                t("settings.appearance.clock.position.subtitle"),
              ),
            ),
            toggle(t("settings.appearance.clock.seconds"), "clockShowSeconds"),
          ],
          heading(
            t("settings.appearance.clock.title"),
            t("settings.appearance.clock.subtitle"),
          ),
        ),
        toggle(t("settings.appearance.fullAnimations"), "enableFixedUI"),
      ],
      heading(t("settings.appearance.title"), t("settings.appearance.subtitle")),
    ),
    submenu(
      t("settings.system.title"),
      "SETTINGS",
      [
        submenu(
          t("settings.system.whosWatching.title"),
          "ACCOUNT_CIRCLE",
          [
            toggle(t("settings.system.whosWatching.on"), "enableWhoIsWatchingMenu"),
            toggle(t("settings.system.whosWatching.always"), "permanentlyEnableWhoIsWatchingMenu"),
            toggle(t("settings.system.whosWatching.onExit"), "enableWhosWatchingMenuOnAppExit"),
          ],
          heading(
            t("settings.system.whosWatching.title"),
            t("settings.system.whosWatching.subtitle"),
          ),
        ),
        toggle(t("settings.system.signInReminder"), "enableSigninReminder"),
        toggle(t("settings.system.welcome"), "showWelcomeToast"),
        submenu(
          t("settings.system.updates.title"),
          "SYSTEM_UPDATE",
          [
            {
              name: t("settings.system.updates.checkNow"),
              icon: "SYSTEM_UPDATE",
              action: "CHECK_FOR_UPDATES",
            },
            toggle(t("settings.system.updates.onStartup"), "enableUpdater", "SYSTEM_UPDATE"),
          ],
          heading(
            t("settings.system.updates.title"),
            t("settings.system.updates.subtitle", { version: AXOTUBE_VERSION }),
          ),
        ),
        { name: t("settings.system.restartCast"), icon: "REFRESH", action: "AXO_CAST_RESTART" },
        { name: t("settings.system.reload"), icon: "REFRESH", action: "AXO_RELOAD_PAGE" },
      ],
      heading(t("settings.system.title"), t("settings.system.subtitle")),
    ),
    submenu(
      t("settings.about.title"),
      "HELP",
      [
        aboutLink("GitHub", "https://github.com/TizenDroid/axotube"),
        aboutLink("Discord", "https://discord.gg/UDb8nak5YD"),
      ],
      heading(t("settings.about.title"), t("settings.about.version", { version: AXOTUBE_VERSION })),
    ),
  ];

  return settings;
}

function dimLabel(seconds) {
  return seconds >= 60 ? t("settings.minutes", { count: seconds / 60 }) : secondsLabel(seconds);
}

// ── Native rendering ─────────────────────────────────────────────────────────
// Panels are built lazily. Opening the menu registers the tree's nodes by id
// ("root.2.0" etc.); each click then rebuilds only the panel it touches and
// updates that modal in place (update: true with the same unique id), which is
// how YouTube's own menus refresh. Submenus push a new modal, so Back works.

const ROOT_ID = "root";
const MODAL_PREFIX = "axo-settings";
let nodes = new Map();
let tree = null;

function registerNodes(list, parentId) {
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    if (!node) continue;
    const id = `${parentId}.${i}`;
    nodes.set(id, node);
    if (Array.isArray(node.options)) registerNodes(node.options, id);
  }
}

function uniqueIdFor(panelId) {
  return `${MODAL_PREFIX}:${panelId}`;
}

function settingCommand(action, parameters) {
  return [{ customAction: { action, parameters } }];
}

function secondsLabel(count) {
  return t("settings.seconds", { count });
}

function rowFor(node, id, arrayKey, panelId) {
  if (node.action) {
    return buttonItem({ title: node.name }, { icon: node.icon }, [
      { customAction: { action: node.action } },
    ]);
  }

  if (node.segment !== undefined) {
    const mode = segmentMode(node.segment);
    return buttonItem(
      { title: node.name, subtitle: t(`settings.segmentModes.${mode}`) },
      { icon: node.icon },
      settingCommand("SETTINGS_SEGMENT", {
        category: node.segment,
        panel: panelId,
        index: idIndex(id),
      }),
    );
  }

  if (arrayKey !== undefined) {
    const on = (configRead(arrayKey) || []).indexOf(node.value) !== -1;
    return buttonItem(
      { title: node.name },
      {
        icon: node.icon,
        secondaryIcon: on ? "CHECK_BOX" : "CHECK_BOX_OUTLINE_BLANK",
      },
      settingCommand("SETTINGS_SET", {
        key: arrayKey,
        valName: "arrayValue",
        value: node.value,
        panel: panelId,
        index: idIndex(id),
      }),
    );
  }

  if (node.key !== undefined) {
    const on = configRead(node.key) === node.value;
    return buttonItem(
      { title: node.name },
      {
        icon: node.icon,
        secondaryIcon: on ? "RADIO_BUTTON_CHECKED" : "RADIO_BUTTON_UNCHECKED",
      },
      settingCommand("SETTINGS_SET", {
        key: node.key,
        valName: "stringValue",
        value: node.value,
        panel: panelId,
        index: idIndex(id),
      }),
    );
  }

  if (node.stepper !== undefined) {
    return buttonItem(
      { title: node.name, subtitle: secondsLabel(configRead(node.value)) },
      {
        icon: node.icon,
      },
      settingCommand("SETTINGS_OPEN", { id }),
    );
  }

  if (node.arrayToEdit !== undefined || (node.options && typeof node.options === "object")) {
    return buttonItem(
      { title: node.name },
      { icon: node.icon },
      settingCommand("SETTINGS_OPEN", { id }),
    );
  }

  if (typeof node.value === "string") {
    return buttonItem(
      { title: node.name },
      {
        icon: node.icon,
        secondaryIcon: configRead(node.value) ? "CHECK_BOX" : "CHECK_BOX_OUTLINE_BLANK",
      },
      settingCommand("SETTINGS_TOGGLE", { key: node.value, panel: panelId, index: idIndex(id) }),
    );
  }

  return null;
}

// Index of the row inside its panel, used to keep focus where the viewer was.
function idIndex(id) {
  const dot = id.lastIndexOf(".");
  return Number(id.slice(dot + 1));
}

function rowsFor(list, parentId, arrayKey) {
  const rows = [];
  for (let i = 0; i < list.length; i++) {
    const node = list[i];
    if (!node) continue;
    const id = `${parentId}.${i}`;
    const row = rowFor(node, id, arrayKey, parentId);
    if (row) rows.push(row);
  }
  return rows;
}

function infoRows(content) {
  const rows = [];
  for (const line of content) {
    if (typeof line === "string") {
      rows.push(overlayMessageRenderer(line));
    } else if (line && line.qrLink) {
      const qr = generateQRCode(line.qrLink);
      if (qr) rows.push(QrCodeRenderer(qr));
    }
  }
  return rows;
}

// Header and rows for one panel. Unknown ids fall back to the root panel.
function panelFor(id) {
  if (id === ROOT_ID || !nodes.has(id)) {
    return {
      header: {
        title: t("settings.ttSettings.title"),
        subtitle: t("settings.ttSettings.madeByText"),
      },
      rows: rowsFor(tree, ROOT_ID),
    };
  }

  const node = nodes.get(id);

  if (node.stepper !== undefined) {
    const value = configRead(node.value);
    const step = node.stepper;
    return {
      header: { title: node.name },
      rows: [
        buttonItem(
          { title: `−${secondsLabel(step)}` },
          null,
          settingCommand("SETTINGS_STEP", {
            key: node.value,
            step: -step,
            panel: id,
          }),
        ),
        overlayMessageRenderer(secondsLabel(value)),
        buttonItem(
          { title: `+${secondsLabel(step)}` },
          null,
          settingCommand("SETTINGS_STEP", {
            key: node.value,
            step,
            panel: id,
          }),
        ),
      ],
    };
  }

  if (node.arrayToEdit !== undefined) {
    return {
      header: node.menuHeader || { title: node.name },
      rows: rowsFor(node.options, id, node.arrayToEdit),
    };
  }

  if (node.options && typeof node.options === "object" && !Array.isArray(node.options)) {
    return {
      header: { title: node.options.title, subtitle: node.options.subtitle },
      rows: infoRows(node.options.content || []),
    };
  }

  return {
    header: node.menuHeader || { title: node.name },
    rows: rowsFor(node.options || [], id),
  };
}

function showPanel(id, update, selectedIndex) {
  const panel = panelFor(id);
  showModal(
    panel.header,
    overlayPanelItemListRenderer(panel.rows, selectedIndex || 0),
    id === ROOT_ID ? MODAL_PREFIX : uniqueIdFor(id),
    update,
  );
}

// Writes a setting, then refreshes the panel that held the control.
function applyAndRefresh(write, panelId, index) {
  write();
  if (panelId) showPanel(panelId, true, index);
}

// Handles the SETTINGS_* custom actions dispatched by the rows above.
export function handleSettingsAction(action, parameters) {
  const p = parameters || {};
  switch (action) {
    case "SETTINGS_OPEN":
      showPanel(p.id, false);
      return;
    case "SETTINGS_TOGGLE":
      applyAndRefresh(
        () => writeClientSetting(p.key, "boolValue", !configRead(p.key)),
        p.panel,
        p.index,
      );
      return;
    case "SETTINGS_SET":
      applyAndRefresh(() => writeClientSetting(p.key, p.valName, p.value), p.panel, p.index);
      return;
    case "SETTINGS_SEGMENT":
      applyAndRefresh(
        () => writeSegmentMode(p.category, SEGMENT_NEXT_MODE[segmentMode(p.category)]),
        p.panel,
        p.index,
      );
      return;
    case "SETTINGS_STEP": {
      const range = configSchema.ranges && configSchema.ranges[p.key];
      const current = Number(configRead(p.key)) || 0;
      let next = current + p.step;
      if (range) next = Math.min(range[1], Math.max(range[0], next));
      applyAndRefresh(() => writeClientSetting(p.key, "intValue", next), p.panel, 1);
      return;
    }
    default:
      return;
  }
}

export default function modernUI() {
  tree = buildSettingsTree();
  nodes = new Map();
  registerNodes(tree, ROOT_ID);
  showPanel(ROOT_ID, false);
}
