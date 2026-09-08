import { configRead } from "../config.js";
import {
  showModal,
  buttonItem,
  overlayPanelItemListRenderer,
  scrollPaneRenderer,
  overlayMessageRenderer,
  QrCodeRenderer,
} from "./ytUI.js";
import qrcode from "qrcode-npm";
import { t } from "i18next";
import { getComprehensiveLanguageList } from "../features/moreSubtitles.js";

const qrcodes = {};

function generateQRCode(link) {
  if (qrcodes[link]) return qrcodes[link];
  try {
    const qr = qrcode.qrcode(6, "H");
    qr.addData(link);
    qr.make();
    const qrDataImgTag = qr.createImgTag(8, 8);
    const qrDataUrl = qrDataImgTag.match(/src="([^"]+)"/)?.[1];
    if (qrDataUrl) {
      qrcodes[link] = qrDataUrl;
      return qrDataUrl;
    }
  } catch (e) {
    console.error("QR code generation failed:", e);
  }
  return null;
}

export default function modernUI(update, parameters) {
  const settings = [
    {
      name: t("settings.supportTT.title"),
      icon: "MONEY_HEART",
      value: null,
      options: {
        title: t("settings.supportTT.title"),
        subtitle: t("settings.supportTT.subtitle"),
        content: scrollPaneRenderer([
          overlayMessageRenderer(t("settings.supportTT.content.1")),
          overlayMessageRenderer(t("settings.supportTT.content.2")),
          overlayMessageRenderer(t("settings.supportTT.content.3")),
          overlayMessageRenderer(t("settings.supportTT.content.4")),
          overlayMessageRenderer(t("settings.supportTT.content.5")),
          overlayMessageRenderer(t("settings.supportTT.content.6")),
        ]),
      },
    },
    {
      name: t("settings.options.socialMedia.title"),
      icon: "PRIVACY_UNLISTED",
      value: null,
      options: [
        {
          name: "GitHub",
          link: "https://github.com/TizenDroid/axotube",
        },
        {
          name: "Discord",
          link: "https://discord.gg/UDb8nak5YD",
        },
      ].map((option) => {
        return {
          name: option.name,
          icon: "OPEN_IN_NEW",
          value: null,
          link: option.link,
          options: {
            title: option.name,
            subtitle: option.link,
            content: overlayPanelItemListRenderer([
              overlayMessageRenderer(
                t("settings.options.socialMedia.qrCodeScanMessage", {
                  name: option.name,
                }),
              ),
              {
                qrCodePlaceholder: true,
                link: option.link,
              },
            ]),
          },
        };
      }),
    },
    {
      name: t("settings.options.adBlock"),
      icon: "DOLLAR_SIGN",
      value: "enableAdBlock",
    },
    {
      name: t("settings.options.sponsorblock.title"),
      icon: "MONEY_HAND",
      value: null,
      menuId: "tt-sponsorblock-settings",
      menuHeader: {
        title: t("settings.options.sponsorblock.title"),
        subtitle: "https://sponsor.ajay.app/",
      },
      options: [
        {
          name: t("settings.options.sponsorblock.options.enableSB"),
          icon: "MONEY_HAND",
          value: "enableSponsorBlock",
        },
        {
          name: t("settings.options.sponsorblock.options.manualSkip"),
          icon: "DOLLAR_SIGN",
          value: null,
          arrayToEdit: "sponsorBlockManualSkips",
          menuId: "tt-sponsorblock-manual-segment-skip",
          options: [
            {
              name: t(
                "settings.options.sponsorblock.options.categories.sponsor",
              ),
              icon: "MONEY_HEART",
              value: "sponsor",
            },
            {
              name: t("settings.options.sponsorblock.options.categories.intro"),
              icon: "PLAY_CIRCLE",
              value: "intro",
            },
            {
              name: t("settings.options.sponsorblock.options.categories.outro"),
              icon: "STOP_CIRCLE",
              value: "outro",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.interaction",
              ),
              icon: "TOUCH_APP",
              value: "interaction",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.selfpromo",
              ),
              icon: "PROMOTION",
              value: "selfpromo",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.preview",
              ),
              icon: "PREVIEW",
              value: "preview",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.filler",
              ),
              icon: "PADDING",
              value: "filler",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.music_offtopic",
              ),
              icon: "MUSIC_NOTE",
              value: "music_offtopic",
            },
          ],
        },
        {
          name: t("settings.options.sponsorblock.options.segments"),
          icon: "SETTINGS",
          value: null,
          menuId: "tt-sponsorblock-segments",
          options: [
            {
              name: t(
                "settings.options.sponsorblock.options.categories.sponsor",
              ),
              icon: "MONEY_HEART",
              value: "enableSponsorBlockSponsor",
            },
            {
              name: t("settings.options.sponsorblock.options.categories.intro"),
              icon: "PLAY_CIRCLE",
              value: "enableSponsorBlockIntro",
            },
            {
              name: t("settings.options.sponsorblock.options.categories.outro"),
              icon: "STOP_CIRCLE",
              value: "enableSponsorBlockOutro",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.interaction",
              ),
              icon: "TOUCH_APP",
              value: "enableSponsorBlockInteraction",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.selfpromo",
              ),
              icon: "PROMOTION",
              value: "enableSponsorBlockSelfPromo",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.preview",
              ),
              icon: "PREVIEW",
              value: "enableSponsorBlockPreview",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.filler",
              ),
              icon: "PADDING",
              value: "enableSponsorBlockFiller",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.music_offtopic",
              ),
              icon: "MUSIC_NOTE",
              value: "enableSponsorBlockMusicOfftopic",
            },
            {
              name: t(
                "settings.options.sponsorblock.options.categories.highlights",
              ),
              icon: "LOCATION_POINT",
              value: "enableSponsorBlockHighlight",
            },
          ],
        },
        {
          name: t("settings.options.sponsorblock.options.showSBToasts"),
          value: "enableSponsorBlockToasts",
        },
      ],
    },
    {
      name: t("settings.options.dearrow.title"),
      icon: "VISIBILITY_OFF",
      value: null,
      menuHeader: {
        title: t("settings.options.dearrow.title"),
        subtitle: "https://dearrow.ajay.app/",
      },
      options: [
        {
          name: t("settings.options.dearrow.options.enableTitles"),
          icon: "VISIBILITY_OFF",
          value: "enableDeArrowTitles",
        },
        {
          name: t("settings.options.dearrow.options.enableThumbnails"),
          icon: "TV",
          value: "enableDeArrowThumbnails",
        },
      ],
    },
    {
      name: t("settings.options.misc.title"),
      icon: "SETTINGS",
      value: null,
      options: [
        {
          name: t("settings.options.misc.options.endScreenCards"),
          icon: "VISIBILITY_OFF",
          value: "enableHideEndScreenCards",
        },
        {
          name: t("settings.options.misc.options.youThereRenderer"),
          icon: "HELP",
          value: "enableYouThereRenderer",
        },
        {
          name: t("settings.options.misc.options.paidPromoOverlay"),
          icon: "MONEY_HAND",
          value: "enablePaidPromotionOverlay",
        },
        {
          name: t("settings.options.misc.options.whosWatching.title"),
          icon: "ACCOUNT_CIRCLE",
          menuId: "tt-whos-watching-menu-settings",
          value: null,
          options: [
            {
              name: t(
                "settings.options.misc.options.whosWatching.options.enableWW",
              ),
              value: "enableWhoIsWatchingMenu",
            },
            {
              name: t(
                "settings.options.misc.options.whosWatching.options.permaEnableWW",
              ),
              value: "permanentlyEnableWhoIsWatchingMenu",
            },
            {
              name: t(
                "settings.options.misc.options.whosWatching.options.enableWWOnExit",
              ),
              value: "enableWhosWatchingMenuOnAppExit",
            },
          ],
        },
        {
          name: t("settings.options.misc.options.fixUI"),
          icon: "STAR",
          value: "enableFixedUI",
        },
        {
          name: t("settings.options.misc.options.reducedMotion"),
          icon: "SLOW_MOTION_VIDEO",
          value: "enableReducedMotion",
        },
        {
          name: t("settings.options.misc.options.hqThumbnails"),
          icon: "VIDEO_QUALITY",
          value: "enableHqThumbnails",
        },
        {
          name: t("settings.options.misc.options.longPress"),
          icon: "TOUCH_APP",
          value: "enableLongPress",
        },
        {
          name: t("settings.options.misc.options.shorts"),
          icon: "YOUTUBE_SHORTS_FILL_24",
          value: "enableShorts",
        },
        {
          name: t("settings.options.misc.options.videoPreviews"),
          icon: "PREVIEW",
          value: "enablePreviews",
        },
        {
          name: t("settings.options.misc.options.ttWelcomeMsg"),
          value: "showWelcomeToast",
        },
        {
          name: t("settings.options.misc.options.guestSignInReminder"),
          value: "enableSigninReminder",
        },
        {
          name: t("settings.options.misc.options.reloadHomeOnStartup"),
          value: "reloadHomeOnStartup",
        },
      ],
    },
    {
      name: t("settings.options.theme.title"),
      icon: "STYLE",
      value: null,
      menuId: "tt-theme-settings",
      menuHeader: {
        title: t("settings.options.theme.title"),
        subtitle: t("settings.options.theme.menuSubtitle"),
      },
      options: [
        {
          name: t("settings.options.theme.options.presets.title"),
          icon: "STYLE",
          value: null,
          menuId: "tt-theme-presets",
          menuHeader: {
            title: t("settings.options.theme.options.presets.title"),
            subtitle: t("settings.options.theme.options.presets.menuSubtitle"),
          },
          options: [
            {
              name: t("settings.options.theme.options.colors.default"),
              icon: "COLOR_LENS",
              key: "themePreset",
              value: "default",
            },
            {
              name: t("settings.options.theme.options.colors.black"),
              icon: "COLOR_LENS",
              key: "themePreset",
              value: "black",
            },
            {
              name: t("settings.options.theme.options.colors.darkGray"),
              icon: "COLOR_LENS",
              key: "themePreset",
              value: "darkGray",
            },
            {
              name: t("settings.options.theme.options.colors.charcoal"),
              icon: "COLOR_LENS",
              key: "themePreset",
              value: "charcoal",
            },
            {
              name: t("settings.options.theme.options.colors.navy"),
              icon: "COLOR_LENS",
              key: "themePreset",
              value: "navy",
            },
            {
              name: t("settings.options.theme.options.colors.darkRed"),
              icon: "COLOR_LENS",
              key: "themePreset",
              value: "darkRed",
            },
            {
              name: t("settings.options.theme.options.colors.darkGreen"),
              icon: "COLOR_LENS",
              key: "themePreset",
              value: "darkGreen",
            },
            {
              name: t("settings.options.theme.options.colors.darkPurple"),
              icon: "COLOR_LENS",
              key: "themePreset",
              value: "darkPurple",
            },
          ],
        },
        {
          name: t("settings.options.theme.options.routeColor.title"),
          icon: "COLOR_LENS",
          value: null,
          menuId: "tt-theme-route-color",
          options: [
            {
              name: t("settings.options.theme.options.colors.default"),
              icon: "COLOR_LENS",
              key: "routeColor",
              value: "#0f0f0f",
            },
            {
              name: t("settings.options.theme.options.colors.black"),
              icon: "COLOR_LENS",
              key: "routeColor",
              value: "#000000",
            },
            {
              name: t("settings.options.theme.options.colors.darkGray"),
              icon: "COLOR_LENS",
              key: "routeColor",
              value: "#1c1a1a",
            },
            {
              name: t("settings.options.theme.options.colors.charcoal"),
              icon: "COLOR_LENS",
              key: "routeColor",
              value: "#121212",
            },
            {
              name: t("settings.options.theme.options.colors.navy"),
              icon: "COLOR_LENS",
              key: "routeColor",
              value: "#0d1b2a",
            },
            {
              name: t("settings.options.theme.options.colors.darkRed"),
              icon: "COLOR_LENS",
              key: "routeColor",
              value: "#3b0505",
            },
            {
              name: t("settings.options.theme.options.colors.darkGreen"),
              icon: "COLOR_LENS",
              key: "routeColor",
              value: "#052e1b",
            },
            {
              name: t("settings.options.theme.options.colors.darkPurple"),
              icon: "COLOR_LENS",
              key: "routeColor",
              value: "#1a1025",
            },
          ],
        },
        {
          name: t("settings.options.theme.options.textTheme.title"),
          icon: "COLOR_LENS",
          value: null,
          menuId: "tt-theme-text-color",
          options: [
            {
              name: t("settings.options.theme.options.colors.default"),
              icon: "COLOR_LENS",
              key: "textTheme",
              value: "default",
            },
            {
              name: t("settings.options.theme.options.textTheme.options.white"),
              icon: "COLOR_LENS",
              key: "textTheme",
              value: "white",
            },
            {
              name: t("settings.options.theme.options.textTheme.options.gray"),
              icon: "COLOR_LENS",
              key: "textTheme",
              value: "gray",
            },
            {
              name: t("settings.options.theme.options.textTheme.options.red"),
              icon: "COLOR_LENS",
              key: "textTheme",
              value: "red",
            },
            {
              name: t("settings.options.theme.options.textTheme.options.blue"),
              icon: "COLOR_LENS",
              key: "textTheme",
              value: "blue",
            },
            {
              name: t("settings.options.theme.options.textTheme.options.green"),
              icon: "COLOR_LENS",
              key: "textTheme",
              value: "green",
            },
            {
              name: t(
                "settings.options.theme.options.textTheme.options.purple",
              ),
              icon: "COLOR_LENS",
              key: "textTheme",
              value: "purple",
            },
            {
              name: t(
                "settings.options.theme.options.textTheme.options.yellow",
              ),
              icon: "COLOR_LENS",
              key: "textTheme",
              value: "yellow",
            },
          ],
        },
      ],
    },
    {
      name: t("settings.options.subtitles.title"),
      icon: "TRANSLATE",
      value: null,
      options: [
        {
          name: t("settings.options.subtitles.options.showLocalSubtitle"),
          value: "enableShowUserLanguage",
        },
        {
          name: t("settings.options.subtitles.options.showHiddenSubtitles"),
          value: "enableShowOtherLanguages",
        },
      ],
    },
    {
      name: t("settings.options.videoPlayer.title"),
      icon: "VIDEO_YOUTUBE",
      value: null,
      menuHeader: {
        title: t("settings.options.videoPlayer.title"),
        subtitle: t("settings.options.videoPlayer.subtitle"),
      },
      options: [
        {
          name: t("settings.options.videoPlayer.options.patching.title"),
          icon: "SETTINGS",
          value: null,
          menuId: "tt-video-player-ui-patching",
          options: [
            {
              name: t(
                "settings.options.videoPlayer.options.patching.options.enableVPUIPatching",
              ),
              icon: "SETTINGS",
              value: "enablePatchingVideoPlayer",
            },
            {
              name: t(
                "settings.options.videoPlayer.options.patching.options.previousNextBtns",
              ),
              icon: "SKIP_NEXT",
              value: "enablePreviousNextButtons",
            },
            {
              name: t(
                "settings.options.videoPlayer.options.patching.options.showSuperThxBtn",
              ),
              icon: "MONEY_HEART",
              value: "enableSuperThanksButton",
            },
            {
              name: t(
                "settings.options.videoPlayer.options.patching.options.showSpeedCtrlBtn",
              ),
              icon: "SLOW_MOTION_VIDEO",
              value: "enableSpeedControlsButton",
            },
            {
              name: t(
                "settings.options.videoPlayer.options.patching.options.addMPBtn",
              ),
              icon: "CLEAR_COOKIES",
              value: "enableMPButton",
            },
            {
              name: t(
                "settings.options.videoPlayer.options.patching.options.swapMPWithPIP",
              ),
              icon: "PICTURE_IN_PICTURE",
              value: "enableSwapMPWithPIP",
            },
          ],
        },
        {
          name: t(
            "settings.options.videoPlayer.options.preferredVideoQuality.title",
          ),
          icon: "VIDEO_QUALITY",
          value: null,
          menuId: "tt-preferred-video-quality",
          menuHeader: {
            title: t(
              "settings.options.videoPlayer.options.preferredVideoQuality.title",
            ),
            subtitle: t(
              "settings.options.videoPlayer.options.preferredVideoQuality.subtitle",
            ),
          },
          options: [
            "Auto",
            "2160p",
            "1440p",
            "1080p",
            "720p",
            "480p",
            "360p",
            "240p",
            "144p",
          ].map((quality) => {
            return {
              name: quality,
              key: "preferredVideoQuality",
              value: quality.toLowerCase(),
            };
          }),
        },
        {
          name: t("settings.options.videoPlayer.options.speedSettings.title"),
          icon: "SLOW_MOTION_VIDEO",
          value: null,
          menuId: "tt-speed-settings-increments",
          menuHeader: {
            title: t(
              "settings.options.videoPlayer.options.speedSettings.title",
            ),
            subtitle: t(
              "settings.options.videoPlayer.options.speedSettings.subtitle",
            ),
          },
          options: [0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map(
            (increment) => {
              return {
                name: `${increment}x`,
                key: "speedSettingsIncrement",
                value: increment,
              };
            },
          ),
        },
        {
          name: t(
            "settings.options.videoPlayer.options.preferredVideoCodec.title",
          ),
          icon: "VIDEO_QUALITY",
          value: null,
          menuId: "tt-preferred-video-codec",
          menuHeader: {
            title: t(
              "settings.options.videoPlayer.options.preferredVideoCodec.title",
            ),
            subtitle: t(
              "settings.options.videoPlayer.options.preferredVideoCodec.subtitle",
            ),
          },
          options: ["any", "vp9", "av01", "avc1"].map((codec) => {
            return {
              name: codec === "any" ? "Any" : codec.toUpperCase(),
              key: "preferredVideoCodec",
              value: codec,
            };
          }),
        },
        window.h5vcc &&
        window.h5vcc.tizentube &&
        window.h5vcc.tizentube.SetFrameRate
          ? {
              name: t("settings.options.videoPlayer.options.afr"),
              icon: "SLOW_MOTION_VIDEO",
              value: "autoFrameRate",
            }
          : null,
        window.h5vcc &&
        window.h5vcc.tizentube &&
        window.h5vcc.tizentube.SetFrameRate
          ? {
              name: t(
                "settings.options.videoPlayer.options.afrPauseDuration.title",
              ),
              icon: "TIMER",
              value: null,
              menuId: "tt-auto-frame-rate-pause-duration",
              menuHeader: {
                title: t(
                  "settings.options.videoPlayer.options.afrPauseDuration.title",
                ),
                subtitle: t(
                  "settings.options.videoPlayer.options.afrPauseDuration.subtitle",
                ),
              },
              options: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map(
                (seconds) => {
                  return {
                    name: `${seconds} seconds`,
                    key: "autoFrameRatePauseVideoFor",
                    value: seconds * 1000,
                  };
                },
              ),
            }
          : null,
      ],
    },
    {
      name: t("settings.options.uiSettings.title"),
      icon: "SETTINGS",
      value: null,
      menuHeader: {
        title: t("settings.options.uiSettings.title"),
        subtitle: t("settings.options.uiSettings.subtitle"),
      },
      options: [
        {
          name: t(
            "settings.options.uiSettings.options.hideWatchedVideos.title",
          ),
          icon: "VISIBILITY_OFF",
          value: null,
          menuId: "tt-hide-watched-videos-settings",
          options: [
            {
              name: t(
                "settings.options.uiSettings.options.hideWatchedVideos.options.enableHideWatchedVideos",
              ),
              icon: "VISIBILITY_OFF",
              value: "enableHideWatchedVideos",
            },
            {
              name: t(
                "settings.options.uiSettings.options.hideWatchedVideos.options.watchedVideosThreshold.title",
              ),
              value: null,
              menuId: "tt-hide-watched-videos-threshold",
              menuHeader: {
                title: t(
                  "settings.options.uiSettings.options.hideWatchedVideos.options.watchedVideosThreshold.title",
                ),
                subtitle: t(
                  "settings.options.uiSettings.options.hideWatchedVideos.options.watchedVideosThreshold.subtitle",
                ),
              },
              options: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map(
                (percent) => {
                  return {
                    name: `${percent}%`,
                    key: "hideWatchedVideosThreshold",
                    value: percent,
                  };
                },
              ),
            },
            {
              name: t(
                "settings.options.uiSettings.options.hideWatchedVideos.options.setPagesToHideWatchedVideos",
              ),
              value: null,
              arrayToEdit: "hideWatchedVideosPages",
              menuId: "tt-hide-watched-videos-pages",
              options: [
                {
                  name: "Search Results",
                  value: "search",
                },
                {
                  name: "Home",
                  value: "home",
                },
                {
                  name: "Music",
                  value: "music",
                },
                {
                  name: "Gaming",
                  value: "gaming",
                },
                {
                  name: "Subscriptions",
                  value: "subscriptions",
                },
                {
                  name: "Library",
                  value: "library",
                },
                {
                  name: "More",
                  value: "more",
                },
              ],
            },
          ],
        },
        {
          name: t("settings.options.uiSettings.options.screenDimming.title"),
          icon: "EYE_OFF",
          value: null,
          menuId: "tt-screen-dimming-settings",
          options: [
            {
              name: t(
                "settings.options.uiSettings.options.screenDimming.options.enableScreenDimming",
              ),
              icon: "EYE_OFF",
              value: "enableScreenDimming",
            },
            {
              name: t(
                "settings.options.uiSettings.options.screenDimming.options.dimmingTimeout.title",
              ),
              icon: "TIMER",
              value: null,
              menuId: "tt-dimming-timeout",
              menuHeader: {
                title: t(
                  "settings.options.uiSettings.options.screenDimming.options.dimmingTimeout.title",
                ),
                subtitle: t(
                  "settings.options.uiSettings.options.screenDimming.options.dimmingTimeout.subtitle",
                ),
              },
              options: [10, 20, 30, 60, 120, 180, 240, 300].map((seconds) => {
                const title =
                  seconds >= 60
                    ? `${seconds / 60} minute${seconds / 60 > 1 ? "s" : ""}`
                    : `${seconds} seconds`;
                return {
                  name: title,
                  key: "dimmingTimeout",
                  value: seconds,
                };
              }),
            },
            {
              name: t(
                "settings.options.uiSettings.options.screenDimming.options.dimmingOpacity.title",
              ),
              icon: "LENS_BLUE",
              value: null,
              menuId: "tt-dimming-opacity",
              menuHeader: {
                title: t(
                  "settings.options.uiSettings.options.screenDimming.options.dimmingOpacity.title",
                ),
                subtitle: t(
                  "settings.options.uiSettings.options.screenDimming.options.dimmingOpacity.subtitle",
                ),
              },
              options: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0].map(
                (opacity) => {
                  return {
                    name: `${Math.round(opacity * 100)}%`,
                    key: "dimmingOpacity",
                    value: opacity,
                  };
                },
              ),
            },
          ],
        },
        {
          name: t(
            "settings.options.uiSettings.options.disableSidebarContents.title",
          ),
          icon: "MENU",
          value: null,
          arrayToEdit: "disabledSidebarContents",
          menuId: "tt-sidebar-contents",
          menuHeader: {
            title: t(
              "settings.options.uiSettings.options.disableSidebarContents.title",
            ),
            subtitle: t(
              "settings.options.uiSettings.options.disableSidebarContents.subtitle",
            ),
          },
          options: [
            {
              name: "Search",
              icon: "SEARCH",
              value: "SEARCH",
            },
            {
              name: "Home",
              icon: "WHAT_TO_WATCH",
              value: "WHAT_TO_WATCH",
            },
            {
              name: "Sports",
              icon: "TROPHY",
              value: "TROPHY",
            },
            {
              name: "News",
              icon: "NEWS",
              value: "NEWS",
            },
            {
              name: "Music",
              icon: "YOUTUBE_MUSIC",
              value: "YOUTUBE_MUSIC",
            },
            {
              name: "Podcasts",
              icon: "BROADCAST",
              value: "BROADCAST",
            },
            {
              name: "Movies & TV",
              icon: "CLAPPERBOARD",
              value: "CLAPPERBOARD",
            },
            {
              name: "Live",
              icon: "LIVE",
              value: "LIVE",
            },
            {
              name: "Gaming",
              icon: "GAMING",
              value: "GAMING",
            },
            {
              name: "Subscriptions",
              icon: "SUBSCRIPTIONS",
              value: "SUBSCRIPTIONS",
            },
            {
              name: "Library",
              icon: "TAB_LIBRARY",
              value: "TAB_LIBRARY",
            },
            {
              name: "More",
              icon: "TAB_MORE",
              value: "TAB_MORE",
            },
          ],
        },
        {
          name: t(
            "settings.options.uiSettings.options.launchToOnStartup.title",
          ),
          icon: "TV",
          value: null,
          menuId: "tt-launch-to-on-startup",
          menuHeader: {
            title: t(
              "settings.options.uiSettings.options.launchToOnStartup.title",
            ),
            subtitle: t(
              "settings.options.uiSettings.options.launchToOnStartup.subtitle",
            ),
          },
          options: [
            {
              name: "Search",
              icon: "SEARCH",
              key: "launchToOnStartup",
              value: JSON.stringify({
                searchEndpoint: { query: "" },
              }),
            },
            {
              name: "Home",
              icon: "WHAT_TO_WATCH",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics" },
              }),
            },
            {
              name: "Sports",
              icon: "TROPHY",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics_sports" },
              }),
            },
            {
              name: "News",
              icon: "NEWS",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics_news" },
              }),
            },
            {
              name: "Music",
              icon: "YOUTUBE_MUSIC",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics_music" },
              }),
            },
            {
              name: "Podcasts",
              icon: "BROADCAST",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics_podcasts" },
              }),
            },
            {
              name: "Movies & TV",
              icon: "CLAPPERBOARD",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics_movies" },
              }),
            },
            {
              name: "Gaming",
              icon: "GAMING",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics_gaming" },
              }),
            },
            {
              name: "Live",
              icon: "LIVE",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics_live" },
              }),
            },
            {
              name: "Subscriptions",
              icon: "SUBSCRIPTIONS",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEsubscriptions" },
              }),
            },
            {
              name: "Library",
              icon: "TAB_LIBRARY",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FElibrary" },
              }),
            },
            {
              name: "More",
              icon: "TAB_MORE",
              key: "launchToOnStartup",
              value: JSON.stringify({
                browseEndpoint: { browseId: "FEtopics_more" },
              }),
            },
          ],
        },
        {
          name: t(
            "settings.options.uiSettings.options.sortSubscriptionsByAlphabet",
          ),
          icon: "SORT",
          value: "sortSubscriptionsByAlphabet",
        },
        {
          name: t(
            "settings.options.uiSettings.options.disableChannelsOnSidebar",
          ),
          icon: "CANCEL",
          value: "disableChannelsOnSidebar",
        },
      ],
    },
    window.h5vcc && window.h5vcc.tizentube
      ? {
          name: t("settings.options.updater.title"),
          icon: "SYSTEM_UPDATE",
          value: null,
          menuHeader: {
            title: t("settings.options.updater.title"),
            subtitle: t("settings.options.updater.menuSubtitle"),
          },
          subtitle: t("settings.options.updater.versionSubtitle", {
            version:
              typeof window.h5vcc.tizentube.GetVersion === "function"
                ? window.h5vcc.tizentube.GetVersion()
                : "unknown",
          }),
          options: [
            buttonItem(
              { title: t("settings.options.updater.options.checkForUpdates") },
              { icon: "SYSTEM_UPDATE" },
              [
                {
                  customAction: {
                    action: "CHECK_FOR_UPDATES",
                  },
                },
              ],
            ),
            {
              name: t(
                "settings.options.updater.options.checkForUpdatesOnStartup",
              ),
              icon: "SYSTEM_UPDATE",
              value: "enableUpdater",
            },
          ],
        }
      : null,
    {
      name: t("settings.options.returnToAxobrew"),
      icon: "OPEN_IN_NEW",
      action: "RETURN_TO_AXOBREW",
    },
  ];

  const buttons = [];

  let index = 0;
  for (const setting of settings) {
    if (!setting) continue;
    if (setting.action) {
      buttons.push(
        buttonItem(
          { title: setting.name },
          { icon: setting.icon ? setting.icon : "CHEVRON_DOWN" },
          [
            {
              customAction: {
                action: setting.action,
              },
            },
          ],
        ),
      );
      index++;
      continue;
    }
    const currentVal = setting.value ? configRead(setting.value) : null;
    buttons.push(
      buttonItem(
        { title: setting.name, subtitle: setting.subtitle },
        {
          icon: setting.icon ? setting.icon : "CHEVRON_DOWN",
          secondaryIcon:
            currentVal === null
              ? "CHEVRON_RIGHT"
              : currentVal
                ? "CHECK_BOX"
                : "CHECK_BOX_OUTLINE_BLANK",
        },
        currentVal !== null
          ? [
              {
                setClientSettingEndpoint: {
                  settingDatas: [
                    {
                      clientSettingEnum: {
                        item: setting.value,
                      },
                      boolValue: !configRead(setting.value),
                    },
                  ],
                },
              },
              {
                customAction: {
                  action: "SETTINGS_UPDATE",
                  parameters: [index],
                },
              },
            ]
          : [
              {
                customAction: {
                  action: "OPTIONS_SHOW",
                  parameters: {
                    options: setting.options,
                    selectedIndex: 0,
                    update: setting.options?.title ? "customUI" : false,
                    menuId: setting.menuId,
                    arrayToEdit: setting.arrayToEdit,
                    menuHeader: setting.menuHeader,
                  },
                },
              },
            ],
      ),
    );
    index++;
  }

  showModal(
    {
      title: t("settings.ttSettings.title"),
      subtitle: t("settings.ttSettings.madeByText"),
    },
    overlayPanelItemListRenderer(
      buttons,
      parameters && parameters.length > 0 ? parameters[0] : 0,
    ),
    "tt-settings",
    update,
  );
}

export function optionShow(parameters, update) {
  if (update === "customUI") {
    const option = parameters.options;
    showModal(
      {
        title: option.title,
        subtitle: option.subtitle,
      },
      option.content,
      "tt-settings-support",
      false,
    );
    return;
  }
  const buttons = [];

  const isArrayBasedOptions = parameters.arrayToEdit !== undefined;

  if (isArrayBasedOptions) {
    const value = configRead(parameters.arrayToEdit);
    for (const option of parameters.options) {
      buttons.push(
        buttonItem(
          { title: option.name, subtitle: option.subtitle },
          {
            icon: option.icon ? option.icon : "CHEVRON_DOWN",
            secondaryIcon: value.includes(option.value)
              ? "CHECK_BOX"
              : "CHECK_BOX_OUTLINE_BLANK",
          },
          [
            {
              setClientSettingEndpoint: {
                settingDatas: [
                  {
                    clientSettingEnum: {
                      item: parameters.arrayToEdit,
                    },
                    arrayValue: option.value,
                  },
                ],
              },
            },
            {
              customAction: {
                action: "OPTIONS_SHOW",
                parameters: {
                  options: parameters.options,
                  selectedIndex: parameters.options.indexOf(option),
                  update: true,
                  menuId: parameters.menuId,
                  arrayToEdit: parameters.arrayToEdit,
                  menuHeader: parameters.menuHeader,
                },
              },
            },
          ],
        ),
      );
    }
  } else {
    let index = 0;
    for (const option of parameters.options) {
      if (!option) continue;
      if (option.compactLinkRenderer) {
        buttons.push(option);
        index++;
        continue;
      }

      if (option.qrCodePlaceholder) {
        const qrUrl = generateQRCode(option.link);
        if (qrUrl) {
          buttons.push(QrCodeRenderer(qrUrl));
        }
        index++;
        continue;
      }

      const isRadioChoice = option.key !== null && option.key !== undefined;
      const configKey = isRadioChoice ? option.key : option.value;
      const currentVal =
        configKey === null || configKey === undefined
          ? null
          : configRead(configKey);
      buttons.push(
        buttonItem(
          { title: option.name, subtitle: option.subtitle },
          {
            icon: option.icon ? option.icon : "CHEVRON_DOWN",
            secondaryIcon: isRadioChoice
              ? currentVal === option.value
                ? "RADIO_BUTTON_CHECKED"
                : "RADIO_BUTTON_UNCHECKED"
              : option.value === null
                ? "CHEVRON_RIGHT"
                : currentVal
                  ? "CHECK_BOX"
                  : "CHECK_BOX_OUTLINE_BLANK",
          },
          option.value === null
            ? [
                {
                  customAction: {
                    action: "OPTIONS_SHOW",
                    parameters: {
                      options: option.options,
                      selectedIndex: 0,
                      update: option.options?.title ? "customUI" : false,
                      menuId: option.menuId,
                      arrayToEdit: option.arrayToEdit,
                      menuHeader: option.menuHeader,
                    },
                  },
                },
              ]
            : isRadioChoice
              ? [
                  {
                    setClientSettingEndpoint: {
                      settingDatas: [
                        {
                          clientSettingEnum: {
                            item: option.key,
                          },
                          stringValue: option.value,
                        },
                      ],
                    },
                  },
                  {
                    customAction: {
                      action: "OPTIONS_SHOW",
                      parameters: {
                        options: parameters.options,
                        selectedIndex: index,
                        update: parameters.options?.title ? "customUI" : true,
                        menuId: parameters.menuId,
                        arrayToEdit: parameters.arrayToEdit,
                        menuHeader: parameters.menuHeader,
                      },
                    },
                  },
                ]
              : [
                  {
                    setClientSettingEndpoint: {
                      settingDatas: [
                        {
                          clientSettingEnum: {
                            item: option.value,
                          },
                          boolValue: !currentVal,
                        },
                      ],
                    },
                  },
                  {
                    customAction: {
                      action: "OPTIONS_SHOW",
                      parameters: {
                        options: parameters.options,
                        selectedIndex: index,
                        update: parameters.options?.title ? "customUI" : true,
                        menuId: parameters.menuId,
                        arrayToEdit: parameters.arrayToEdit,
                        menuHeader: parameters.menuHeader,
                      },
                    },
                  },
                ],
        ),
      );
      index++;
    }
  }

  showModal(
    parameters.menuHeader ? parameters.menuHeader : "axotube Settings",
    overlayPanelItemListRenderer(buttons, parameters.selectedIndex),
    parameters.menuId || "tt-settings-options",
    update,
  );
}
