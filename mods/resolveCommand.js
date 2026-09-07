import { configWrite, configRead } from "./config.js";
import { enablePip } from "./features/pictureInPicture.js";
import modernUI, { optionShow } from "./ui/settings.js";
import { speedSettings } from "./ui/speedUI.js";
import { showToast, buttonItem } from "./ui/ytUI.js";
import checkForUpdates from "./features/updater.js";

export default function resolveCommand(cmd, _) {
  if (!window._yttv) return;
  try {
    for (const key in window._yttv) {
      if (
        window._yttv[key] &&
        window._yttv[key].instance &&
        typeof window._yttv[key].instance.resolveCommand === "function"
      ) {
        return window._yttv[key].instance.resolveCommand(cmd, _);
      }
    }
  } catch (err) {}
}

export function findFunction(funcName) {
  if (!window._yttv) return;
  try {
    for (const key in window._yttv) {
      if (
        window._yttv[key] &&
        window._yttv[key][funcName] &&
        typeof window._yttv[key][funcName] === "function"
      ) {
        return window._yttv[key][funcName];
      }
    }
  } catch (err) {}
}

export function patchResolveCommand() {
  if (!window._yttv) return false;
  let patched = false;
  for (const key in window._yttv) {
    if (
      window._yttv[key] &&
      window._yttv[key].instance &&
      typeof window._yttv[key].instance.resolveCommand === "function"
    ) {
      if (window._yttv[key].instance.resolveCommand.__axotubePatched) {
        patched = true;
        continue;
      }
      const ogResolve = window._yttv[key].instance.resolveCommand;
      window._yttv[key].instance.resolveCommand = function (cmd, _) {
        if (cmd.setClientSettingEndpoint) {
          for (const settingData of cmd.setClientSettingEndpoint.settingDatas) {
            if (!settingData.clientSettingEnum.item.includes("_")) {
              const valName = Object.keys(settingData).find((settingKey) => settingKey.includes("Value"));
              const value = valName === "intValue" ? Number(settingData[valName]) : settingData[valName];
              if (valName === "arrayValue") {
                const current = configRead(settingData.clientSettingEnum.item);
                const arr = Array.isArray(current) ? current.slice() : [];
                if (arr.includes(value)) arr.splice(arr.indexOf(value), 1);
                else arr.push(value);
                configWrite(settingData.clientSettingEnum.item, arr);
              } else if (settingData.clientSettingEnum.item === "themePreset") {
                const preset = {
                  default: "#0f0f0f",
                  black: "#000000",
                  darkGray: "#1c1a1a",
                  charcoal: "#121212",
                  navy: "#0d1b2a",
                  darkRed: "#3b0505",
                  darkGreen: "#052e1b",
                  darkPurple: "#1a1025",
                }[value];
                if (preset) {
                  configWrite("routeColor", preset);
                  configWrite("themePreset", value);
                }
              } else {
                configWrite(settingData.clientSettingEnum.item, value);
              }
            } else if (settingData.clientSettingEnum.item === "I18N_LANGUAGE") {
              const lang = settingData.stringValue;
              const date = new Date();
              date.setFullYear(date.getFullYear() + 10);
              document.cookie = `PREF=hl=${lang}; expires=${date.toUTCString()};`;
              resolveCommand({ signalAction: { signal: "RELOAD_PAGE" } });
              return true;
            }
          }
        } else if (cmd.customAction) {
          customAction(cmd.customAction.action, cmd.customAction.parameters);
          return true;
        } else if (cmd?.signalAction?.customAction) {
          customAction(cmd.signalAction.customAction.action, cmd.signalAction.customAction.parameters);
          return true;
        } else if (cmd?.showEngagementPanelEndpoint?.customAction) {
          customAction(cmd.showEngagementPanelEndpoint.customAction.action, cmd.showEngagementPanelEndpoint.customAction.parameters);
          return true;
        } else if (cmd?.playlistEditEndpoint?.customAction) {
          customAction(cmd.playlistEditEndpoint.customAction.action, cmd.playlistEditEndpoint.customAction.parameters);
          return true;
        } else if (cmd?.openPopupAction?.uniqueId === "playback-settings") {
          try {
            const items =
              cmd.openPopupAction.popup.overlaySectionRenderer.overlay
                .overlayTwoPanelRenderer.actionPanel.overlayPanelRenderer.content
                .overlayPanelItemListRenderer.items;
            for (const item of items) {
              if (item?.compactLinkRenderer?.icon?.iconType === "SLOW_MOTION_VIDEO") {
                if (item.compactLinkRenderer.subtitle) item.compactLinkRenderer.subtitle.simpleText = "with axotube";
                item.compactLinkRenderer.serviceEndpoint = {
                  clickTrackingParams: "null",
                  signalAction: {
                    customAction: { action: "TT_SPEED_SETTINGS_SHOW", parameters: [] },
                  },
                };
              }
            }

            items.splice(
              2,
              0,
              buttonItem({ title: "Mini Player" }, { icon: "CLEAR_COOKIES" }, [
                { customAction: { action: "ENTER_MP" } },
              ]),
            );

            if (
              window.h5vcc &&
              window.h5vcc.tizentube &&
              window.h5vcc.tizentube?.HasSystemFeature(
                "android.software.picture_in_picture",
              )
            ) {
              items.splice(
                3,
                0,
                buttonItem({ title: "Picture in Picture" }, { icon: "PIP" }, [
                  { customAction: { action: "ENTER_PIP" } },
                  { signalAction: { signal: "POPUP_BACK" } },
                ]),
              );
            }
          } catch (err) {
            console.warn("Playback settings patch failed:", err);
          }
        } else if (cmd?.watchEndpoint?.videoId) {
          window.isPipPlaying = false;
          const ytlrPlayerContainer = document.querySelector("ytlr-player-container");
          if (ytlrPlayerContainer) ytlrPlayerContainer.style.removeProperty("z-index");
        }

        if (cmd.commandExecutorCommand && cmd.commandExecutorCommand.commands) {
          for (const command of cmd.commandExecutorCommand.commands) {
            if (command.customAction) {
              customAction(command.customAction.action, command.customAction.parameters);
            } else if (command.signalAction?.customAction) {
              customAction(command.signalAction.customAction.action, command.signalAction.customAction.parameters);
            } else if (command.showEngagementPanelEndpoint?.customAction) {
              customAction(command.showEngagementPanelEndpoint.customAction.action, command.showEngagementPanelEndpoint.customAction.parameters);
            } else if (command.playlistEditEndpoint?.customAction) {
              customAction(command.playlistEditEndpoint.customAction.action, command.playlistEditEndpoint.customAction.parameters);
            } else {
              ogResolve.call(this, command, _);
            }
          }
          return true;
        }

        if (
          cmd?.requestAccountSelectorCommand &&
          cmd.requestAccountSelectorCommand?.identityActionContext?.eventTrigger === "ACCOUNT_EVENT_TRIGGER_ON_EXIT" &&
          !configRead("enableWhosWatchingMenuOnAppExit")
        ) {
          ogResolve.call(this, { signalAction: { signal: "EXIT_APP" } });
          return false;
        }

        return ogResolve.call(this, cmd, _);
      };
      window._yttv[key].instance.resolveCommand.__axotubePatched = true;
      patched = true;
    }
  }
  return patched;
}

function customAction(action, parameters) {
  switch (action) {
    case "SETTINGS_UPDATE":
      modernUI(true, parameters);
      break;
    case "OPTIONS_SHOW":
      optionShow(parameters, parameters.update);
      break;
    case "SKIP": {
      const kE = document.createEvent("Event");
      kE.initEvent("keydown", true, true);
      kE.keyCode = 27;
      kE.which = 27;
      document.dispatchEvent(kE);
      const video = document.querySelector("video");
      if (video && parameters) video.currentTime = parameters.time;
      break;
    }
    case "TT_SETTINGS_SHOW":
      modernUI();
      break;
    case "TT_SPEED_SETTINGS_SHOW":
      speedSettings();
      break;
    case "UPDATE_REMIND_LATER":
      configWrite("dontCheckUpdateUntil", parameters);
      break;
    case "UPDATE_DOWNLOAD":
      if (
        window.h5vcc &&
        window.h5vcc.tizentube &&
        window.h5vcc.tizentube.InstallAppFromURL
      ) {
        window.h5vcc.tizentube.InstallAppFromURL(parameters);
        showToast("axotube Update", "Downloading update, please wait...");
      }
      break;
    case "SET_PLAYER_SPEED": {
      const speed = Number(parameters);
      const video = document.querySelector("video");
      if (video && Number.isFinite(speed)) video.playbackRate = speed;
      break;
    }
    case "ENTER_MP":
      enablePip();
      break;
    case "ENTER_PIP":
      if (
        window.h5vcc &&
        window.h5vcc.tizentube &&
        window.h5vcc.tizentube.EnterPIP
      ) {
        window.h5vcc.tizentube.EnterPIP();
      }
      break;
    case "SHOW_TOAST":
      showToast("axotube", parameters);
      break;
    case "ADD_TO_QUEUE":
      if (parameters) window.queuedVideos.videos.push(parameters);
      showToast("axotube", "Video added to queue.");
      break;
    case "CLEAR_QUEUE":
      window.queuedVideos.videos = [];
      window.queuedVideos.currentIndex = -1;
      window.queuedVideos.lastVideoId = null;
      showToast("axotube", "Video queue cleared.");
      break;
    case "CHECK_FOR_UPDATES":
      checkForUpdates(true);
      break;
  }
}
