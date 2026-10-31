import { nativeHost } from "./shared/nativeHost.js";
import { t } from "i18next";
import { configWrite, configRead } from "./config.js";
import { enablePip, cleanupPipStyles } from "./features/pictureInPicture.js";
import { pauseForOpenedOverlay } from "./features/pauseOnBlur.js";
import { applyDeArrowPeek } from "./features/deArrowPeek.js";
import { restartCastReceiver } from "./features/castDiscovery.js";
import modernUI, { handleSettingsAction } from "./ui/settings.js";
import { writeClientSetting } from "./shared/clientSettings.js";
import { speedSettings } from "./ui/speedUI.js";
import { showToast, buttonItem } from "./ui/ytUI.js";
import checkForUpdates, { applyUpdate } from "./features/updater.js";
import { dispatchNativeCommand, registerNativeResolverPatcher } from "./shared/nativeCommand.js";

export default function resolveCommand(cmd, _) {
  return dispatchNativeCommand(cmd, _);
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
  return registerNativeResolverPatcher(patchNativeResolverInstance);
}

function patchNativeResolverInstance(instance) {
  const ogResolve = instance.resolveCommand;
  if (ogResolve.__axotubePatched) return true;
  const patchedResolve = function (cmd, _) {
    if (!cmd || typeof cmd !== "object") return ogResolve.call(this, cmd, _);
    applyDeArrowPeek(cmd);
    pauseForOpenedOverlay(cmd);

    if (cmd.setClientSettingEndpoint) {
      if (!Array.isArray(cmd.setClientSettingEndpoint.settingDatas)) {
        return ogResolve.call(this, cmd, _);
      }
      for (const settingData of cmd.setClientSettingEndpoint.settingDatas) {
        const itemName = settingData?.clientSettingEnum?.item;
        if (typeof itemName !== "string") continue;

        if (!itemName.includes("_")) {
          const valName = Object.keys(settingData).find((settingKey) =>
            settingKey.includes("Value"),
          );
          if (!valName) continue;
          const value =
            valName === "intValue" ? Number(settingData[valName]) : settingData[valName];
          writeClientSetting(itemName, valName, value);
        } else if (itemName === "I18N_LANGUAGE") {
          const lang = settingData.stringValue;
          if (typeof lang !== "string" || !lang) continue;
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
      customAction(
        cmd.showEngagementPanelEndpoint.customAction.action,
        cmd.showEngagementPanelEndpoint.customAction.parameters,
      );
      return true;
    } else if (cmd?.playlistEditEndpoint?.customAction) {
      customAction(
        cmd.playlistEditEndpoint.customAction.action,
        cmd.playlistEditEndpoint.customAction.parameters,
      );
      return true;
    } else if (cmd?.openPopupAction?.uniqueId === "playback-settings") {
      try {
        const items =
          cmd.openPopupAction.popup.overlaySectionRenderer.overlay.overlayTwoPanelRenderer
            .actionPanel.overlayPanelRenderer.content.overlayPanelItemListRenderer.items;
        if (!Array.isArray(items)) return ogResolve.call(this, cmd, _);
        for (const item of items) {
          if (item?.compactLinkRenderer?.icon?.iconType === "SLOW_MOTION_VIDEO") {
            if (item.compactLinkRenderer.subtitle)
              item.compactLinkRenderer.subtitle.simpleText = t("player.withAxotube");
            item.compactLinkRenderer.serviceEndpoint = {
              clickTrackingParams: "null",
              signalAction: {
                customAction: { action: "AXO_SPEED_SETTINGS_SHOW", parameters: [] },
              },
            };
          }
        }

        items.splice(
          2,
          0,
          buttonItem({ title: t("player.miniPlayer") }, { icon: "CLEAR_COOKIES" }, [
            { customAction: { action: "ENTER_MP" } },
          ]),
        );

        if (
          nativeHost() &&
          nativeHost()?.HasSystemFeature("android.software.picture_in_picture")
        ) {
          items.splice(
            3,
            0,
            buttonItem({ title: t("player.pictureInPicture") }, { icon: "PIP" }, [
              { customAction: { action: "ENTER_PIP" } },
              { signalAction: { signal: "POPUP_BACK" } },
            ]),
          );
        }
      } catch (err) {
        console.warn("[AxoTube:resolveCommand] Playback settings patch failed:", err);
      }
    } else if (cmd?.watchEndpoint?.videoId) {
      window.isPipPlaying = false;
      cleanupPipStyles();
    }

    if (cmd.commandExecutorCommand && Array.isArray(cmd.commandExecutorCommand.commands)) {
      for (const command of cmd.commandExecutorCommand.commands) {
        if (!command || typeof command !== "object") continue;
        if (command.customAction) {
          customAction(command.customAction.action, command.customAction.parameters);
        } else if (command.signalAction?.customAction) {
          customAction(
            command.signalAction.customAction.action,
            command.signalAction.customAction.parameters,
          );
        } else if (command.showEngagementPanelEndpoint?.customAction) {
          customAction(
            command.showEngagementPanelEndpoint.customAction.action,
            command.showEngagementPanelEndpoint.customAction.parameters,
          );
        } else if (command.playlistEditEndpoint?.customAction) {
          customAction(
            command.playlistEditEndpoint.customAction.action,
            command.playlistEditEndpoint.customAction.parameters,
          );
        } else {
          ogResolve.call(this, command, _);
        }
      }
      return true;
    }

    if (
      cmd?.requestAccountSelectorCommand &&
      cmd.requestAccountSelectorCommand?.identityActionContext?.eventTrigger ===
        "ACCOUNT_EVENT_TRIGGER_ON_EXIT" &&
      !configRead("enableWhosWatchingMenuOnAppExit")
    ) {
      ogResolve.call(this, { signalAction: { signal: "EXIT_APP" } });
      return false;
    }

    return ogResolve.call(this, cmd, _);
  };
  patchedResolve.__axotubePatched = true;
  try {
    instance.resolveCommand = patchedResolve;
    return instance.resolveCommand === patchedResolve;
  } catch (e) {
    return false;
  }
}

function customAction(action, parameters) {
  switch (action) {
    case "SKIP": {
      const kE = document.createEvent("Event");
      kE.initEvent("keydown", true, true);
      kE.keyCode = 27;
      kE.which = 27;
      document.dispatchEvent(kE);
      const video = document.querySelector("video");
      const skipTime = Number(parameters?.time);
      if (video && Number.isFinite(skipTime)) video.currentTime = skipTime;
      break;
    }
    case "AXO_SETTINGS_SHOW":
      modernUI();
      break;
    case "SETTINGS_OPEN":
    case "SETTINGS_SET":
    case "SETTINGS_TOGGLE":
    case "SETTINGS_STEP":
    case "SETTINGS_SEGMENT":
      handleSettingsAction(action, parameters);
      break;
    case "AXO_SPEED_SETTINGS_SHOW":
      speedSettings();
      break;
    case "UPDATE_REMIND_LATER":
      configWrite("dontCheckUpdateUntil", parameters);
      break;
    case "AXO_UPDATE_APPLY":
      applyUpdate();
      break;
    case "SET_PLAYER_SPEED": {
      const speed = Number(parameters);
      const video = document.querySelector("video");
      if (video && Number.isFinite(speed) && speed > 0) video.playbackRate = speed;
      break;
    }
    case "ENTER_MP":
      enablePip();
      break;
    case "ENTER_PIP":
      if (nativeHost() && nativeHost().EnterPIP) {
        nativeHost().EnterPIP();
      }
      break;
    case "SHOW_TOAST":
      showToast(t("app.name"), parameters);
      break;
    case "ADD_TO_QUEUE":
      // Confirm only what happened: an empty payload adds nothing.
      if (parameters) {
        window.queuedVideos.videos.push(parameters);
        showToast(t("app.name"), t("toasts.queueAdded"));
      } else {
        showToast(t("app.name"), t("toasts.queueAddFailed"));
      }
      break;
    case "CLEAR_QUEUE":
      window.queuedVideos.videos = [];
      window.queuedVideos.currentIndex = -1;
      window.queuedVideos.lastVideoId = null;
      showToast(t("app.name"), t("toasts.queueCleared"));
      break;
    case "CHECK_FOR_UPDATES":
      checkForUpdates(true);
      break;
    case "AXO_CAST_RESTART":
      restartCastReceiver();
      break;
    case "AXO_RELOAD_PAGE":
      // Reloads the page, so the proxy serves the HTML and both bundles fresh.
      window.location.reload();
      break;
  }
}
