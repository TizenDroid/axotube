import css from "./ui.css";
import { configRead, configChangeEmitter } from "../config.js";
import updateStyle from "./theme.js";
import { showToast } from "./ytUI.js";
import modernUI from "./settings.js";
import resolveCommand, { patchResolveCommand } from "../resolveCommand.js";
import { pipToFullscreen } from "../features/pictureInPicture.js";
import getCommandExecutor from "./customCommandExecution.js";
import { t } from "i18next";
import AXOTUBE_VERSION from "../version.js";

let initialized = false;
let keyTimeout = null;
let screenIsDimmed = false;

function applyReducedMotionFlags() {
  try {
    if (!window.tectonicConfig?.featureSwitches) return;
    const flags = window.tectonicConfig.featureSwitches;
    const reduced = !!configRead("enableReducedMotion");
    flags.enableAnimations = !reduced;
    flags.enableOnScrollLinearAnimation = !reduced;
    flags.enableListAnimations = !reduced;
    flags.horizontalListDurationMs = reduced ? 0 : 200;
    flags.verticalListDurationMs = reduced ? 0 : 300;
    flags.listAnimationCurve = reduced ? "linear" : "";
    flags.enableSkipButtonSlideInAnimation = !reduced;
    flags.enableLikeButtonAnimation = !reduced;
  } catch (e) {
    console.warn("Reduced motion flags apply failed:", e);
  }
}

function applyReducedMotionBody() {
  try {
    if (!document.body) return;
    document.body.classList.toggle(
      "axotube-reduced-motion",
      !!configRead("enableReducedMotion"),
    );
  } catch (e) {
    console.warn("Reduced motion apply failed:", e);
  }
}

function restoreScreenOpacity() {
  if (!screenIsDimmed) return;
  const container = document.getElementById("container");
  if (container) container.style.setProperty("opacity", "1", "important");
  screenIsDimmed = false;
}

function clearDimmingTimer() {
  if (keyTimeout) {
    clearTimeout(keyTimeout);
    keyTimeout = null;
  }
  restoreScreenOpacity();
}

function armDimmingTimer() {
  clearDimmingTimer();
  if (!configRead("enableScreenDimming")) return;
  keyTimeout = setTimeout(() => {
    keyTimeout = null;
    if (!configRead("enableScreenDimming")) {
      restoreScreenOpacity();
      return;
    }
    const videoPlayer = document.querySelector(".html5-video-player");
    if (!videoPlayer) return;
    const playerStateObject = videoPlayer.getPlayerStateObject?.();
    if (playerStateObject?.isPlaying) return;
    const container = document.getElementById("container");
    if (container) {
      container.style.setProperty(
        "opacity",
        (1 - configRead("dimmingOpacity")).toString(),
        "important",
      );
      screenIsDimmed = true;
    }
  }, configRead("dimmingTimeout") * 1000);
}

function execute_once_dom_loaded() {
  if (initialized) return;
  if (!document.body || !window._yttv) return;
  initialized = true;

  applyReducedMotionFlags();
  applyReducedMotionBody();

  const existingStyle = document.querySelector("style[nonce]");
  if (existingStyle) {
    existingStyle.textContent += css;
  } else if (document.head) {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (typeof window.__releaseBootLoader === "function") {
    window.__releaseBootLoader();
  }

  if (configRead("enableFixedUI")) {
    try {
      if (window.tectonicConfig) {
        window.tectonicConfig.featureSwitches.isLimitedMemory = false;
        window.tectonicConfig.clientData.legacyApplicationQuality = "full-animation";
        window.tectonicConfig.featureSwitches.enableAnimations = true;
        window.tectonicConfig.featureSwitches.enableOnScrollLinearAnimation = true;
        window.tectonicConfig.featureSwitches.enableListAnimations = true;
      }
    } catch (e) {
      console.warn("Could not apply UI fixes:", e);
    }
  }
  applyReducedMotionFlags();

  const eventHandler = (evt) => {
    if (configRead("enableScreenDimming")) armDimmingTimer();

    if (evt.keyCode == 404 && evt.type === "keydown") {
      try {
        modernUI();
      } catch (e) {
        console.error("Settings open failed:", e);
      }
    } else if (evt.keyCode == 39 && evt.type === "keydown") {
      if (document.querySelector("ytlr-search-text-box > .zylon-focus") && window.isPipPlaying) {
        try {
          const ytlrPlayer = document.querySelector("ytlr-player");
          if (ytlrPlayer) ytlrPlayer.style.setProperty("background-color", "rgb(0, 0, 0)");
          pipToFullscreen();
        } catch (e) {
          console.warn("PiP exit failed:", e);
        }
      }
    }
    return true;
  };

  document.addEventListener("keydown", eventHandler, true);
  document.addEventListener("keypress", eventHandler, true);
  document.addEventListener("keyup", eventHandler, true);

  setTimeout(() => {
    if (configRead("showWelcomeToast")) {
      showToast(t("welcomeMsg.title"), `${t("welcomeMsg.subtitle")} · v${AXOTUBE_VERSION}`);
    }
  }, 1000);

  const launchData = configRead("launchToOnStartup");
  if (launchData) {
    try {
      resolveCommand(JSON.parse(launchData));
    } catch (e) {
      console.warn("Launch command failed:", e);
    }
  } else if (configRead("reloadHomeOnStartup")) {
    try {
      if (location.hash && location.hash.substring(1) !== "/") location.hash = "/";
    } catch (e) {
      console.warn("Reload home on startup failed:", e);
    }
  }

  try {
    const commandExecutor = getCommandExecutor();
    if (commandExecutor) {
      commandExecutor.executeFunction(new commandExecutor.commandFunction("reloadGuideAction"));
    }
  } catch (e) {
    console.warn("Guide reload failed:", e);
  }

  if (configRead("enableFixedUI")) {
    try {
      const observer = new MutationObserver(() => {
        const body = document.body;
        if (body?.classList.contains("app-quality-root")) body.classList.remove("app-quality-root");
      });
      observer.observe(document.body, { attributes: true });
    } catch (e) {
      console.warn("UI quality observer failed:", e);
    }
  }

  ensureResolveCommandPatched();
}

let resolveCommandPatchAttempts = 0;
function ensureResolveCommandPatched() {
  try {
    if (patchResolveCommand()) return;
  } catch (e) {}
  resolveCommandPatchAttempts += 1;
  if (resolveCommandPatchAttempts >= 100) {
    console.warn("axotube: gave up waiting for window._yttv instance.resolveCommand to appear");
    return;
  }
  setTimeout(ensureResolveCommandPatched, 100);
}

function checkInitialization() {
  if (initialized) return;
  if (document.readyState === "complete" || document.readyState === "interactive") {
    if (window._yttv) execute_once_dom_loaded();
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", checkInitialization);
}

let initAttempts = 0;
const initInterval = setInterval(() => {
  initAttempts += 1;
  checkInitialization();
  if (initialized || initAttempts >= 100) clearInterval(initInterval);
}, 100);

const THEME_KEYS = {
  routeColor: true,
  routeBackgroundUrl: true,
  themePreset: true,
  textTheme: true,
};

configChangeEmitter.addEventListener("configChange", (e) => {
  const key = e.detail?.key;
  if (THEME_KEYS[key]) updateStyle();

  if (key === "enableReducedMotion") {
    applyReducedMotionBody();
    applyReducedMotionFlags();
  }

  if (key === "enableScreenDimming") {
    if (configRead("enableScreenDimming")) armDimmingTimer();
    else clearDimmingTimer();
  }
});
