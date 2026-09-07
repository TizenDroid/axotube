import { configRead, configChangeEmitter } from "../config.js";
import { showModal, buttonItem, overlayPanelItemListRenderer } from "./ytUI.js";

let boundVideo = null;
let keyHandlersInitialized = false;

function applyConfiguredSpeed(video) {
  if (!video) return;
  try {
    video.playbackRate = configRead("videoSpeed");
  } catch (e) {
    console.warn("Speed apply failed:", e);
  }
}

function attachVideo() {
  const video = document.querySelector("video");
  if (!video || video === boundVideo) return;

  if (boundVideo) {
    try { boundVideo.removeEventListener("canplay", onCanPlay); } catch (e) {}
  }
  boundVideo = video;
  try {
    boundVideo.addEventListener("canplay", onCanPlay);
  } catch (e) {
    console.warn("Speed initialization failed:", e);
  }
  // canplay may already have fired before this module attached.
  applyConfiguredSpeed(boundVideo);
}

function onCanPlay() {
  const current = document.querySelector("video");
  if (current !== boundVideo) attachVideo();
  applyConfiguredSpeed(current || boundVideo);
}

function initKeyHandlers() {
  if (keyHandlersInitialized) return;
  keyHandlersInitialized = true;
  const eventHandler = (evt) => {
    if (evt.keyCode == 406 || evt.keyCode == 191) {
      evt.preventDefault();
      evt.stopPropagation();
      if (evt.type === "keydown") {
        speedSettings();
        return false;
      }
      return true;
    }
  };
  document.addEventListener("keydown", eventHandler, true);
  document.addEventListener("keypress", eventHandler, true);
  document.addEventListener("keyup", eventHandler, true);
}

function initSpeed() {
  initKeyHandlers();
  attachVideo();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSpeed);
} else {
  initSpeed();
}

if (window.addEventListener) {
  window.addEventListener("hashchange", () => setTimeout(attachVideo, 0));
}
setInterval(attachVideo, 2000);

configChangeEmitter.addEventListener("configChange", (event) => {
  if (event.detail?.key === "videoSpeed") {
    attachVideo();
    applyConfiguredSpeed(boundVideo);
  }
});

function speedSettings() {
  const currentSpeed = configRead("videoSpeed");
  let selectedIndex = 0;
  const maxSpeed = 5;
  const increment = configRead("speedSettingsIncrement") || 0.25;
  const buttons = [];

  for (let speed = increment; speed <= maxSpeed; speed += increment) {
    const fixedSpeed = Math.round(speed * 100) / 100;
    buttons.push(
      buttonItem({ title: `${fixedSpeed}x` }, null, [
        { signalAction: { signal: "POPUP_BACK" } },
        {
          setClientSettingEndpoint: {
            settingDatas: [
              {
                clientSettingEnum: { item: "videoSpeed" },
                intValue: fixedSpeed.toString(),
              },
            ],
          },
        },
        {
          customAction: {
            action: "SET_PLAYER_SPEED",
            parameters: fixedSpeed.toString(),
          },
        },
      ]),
    );
    if (currentSpeed === fixedSpeed) selectedIndex = buttons.length - 1;
  }

  buttons.push(
    buttonItem({ title: `Fix stuttering (1.0001x)` }, null, [
      { signalAction: { signal: "POPUP_BACK" } },
      {
        setClientSettingEndpoint: {
          settingDatas: [
            {
              clientSettingEnum: { item: "videoSpeed" },
              intValue: "1.0001",
            },
          ],
        },
      },
      {
        customAction: {
          action: "SET_PLAYER_SPEED",
          parameters: "1.0001",
        },
      },
    ]),
  );

  try {
    showModal(
      "Playback Speed",
      overlayPanelItemListRenderer(buttons, selectedIndex),
      "tt-speed",
    );
  } catch (e) {
    console.error("Speed settings modal failed:", e);
  }
}

export { speedSettings };
