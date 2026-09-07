// Picture in Picture Mode for axotube

function getResolveCommand() {
  if (window._yttv_resolveCommand) return window._yttv_resolveCommand;
  if (!window._yttv) return null;
  try {
    const root = Object.values(window._yttv).find(
      (a) => a && a.instance && typeof a.instance.resolveCommand === "function",
    );
    return root?.instance?.resolveCommand || null;
  } catch (e) {
    return null;
  }
}

window.isPipPlaying = false;
let PlayerService = null;
let observerPipEnter = null;
let pipLoadTimer = null;
let pipLoadAttempts = 0;
const MAX_PIP_LOAD_ATTEMPTS = 120;

function schedulePipLoad() {
  if (pipLoadTimer || pipLoadAttempts >= MAX_PIP_LOAD_ATTEMPTS) return;
  pipLoadTimer = setTimeout(() => {
    pipLoadTimer = null;
    pipLoad();
  }, 250);
}

function pipLoad() {
  pipLoadAttempts += 1;
  try {
    const mappings = window._yttv
      ? Object.values(window._yttv).find((a) => a && a.mappings instanceof Map)
      : null;
    if (!mappings) {
      schedulePipLoad();
      return false;
    }

    const playerService = mappings.get("PlayerService");
    const PlaybackPreviewService = mappings.get("PlaybackPreviewService");
    if (!playerService || !PlaybackPreviewService) {
      schedulePipLoad();
      return false;
    }
    PlayerService = playerService;

    if (!PlaybackPreviewService.__axotubePipPatched) {
      const PlaybackPreviewServiceStart = PlaybackPreviewService.start;
      const PlaybackPreviewServiceStop = PlaybackPreviewService.stop;
      if (typeof PlaybackPreviewServiceStart === "function") {
        PlaybackPreviewService.start = function (...args) {
          if (window.isPipPlaying) return;
          return PlaybackPreviewServiceStart.apply(this, args);
        };
      }
      if (typeof PlaybackPreviewServiceStop === "function") {
        PlaybackPreviewService.stop = function (...args) {
          if (window.isPipPlaying) return;
          return PlaybackPreviewServiceStop.apply(this, args);
        };
      }
      PlaybackPreviewService.__axotubePipPatched = true;
    }
    return true;
  } catch (e) {
    console.warn("PiP service loading failed:", e);
    schedulePipLoad();
    return false;
  }
}

if (document.readyState === "complete") pipLoad();
else window.addEventListener("load", pipLoad);

function cleanupPipStyles() {
  const video = document.querySelector("video");
  if (video) {
    ["width", "height", "top", "left", "inset"].forEach((p) => video.style.removeProperty(p));
  }
  const container = document.querySelector("ytlr-player-container");
  if (container) container.style.removeProperty("z-index");
  const button = document.querySelector("#tt-pip-button");
  if (button && button.parentNode) button.parentNode.removeChild(button);
}

function enablePip() {
  if (!PlayerService && !pipLoad()) {
    // A settings click can arrive before YouTube's service map. Retry the same
    // user action for a short bounded window instead of silently doing nothing.
    let attempts = 0;
    const retry = () => {
      attempts += 1;
      if (PlayerService || pipLoad()) {
        enablePip();
      } else if (attempts < 20) {
        setTimeout(retry, 200);
      }
    };
    setTimeout(retry, 200);
    return;
  }

  try {
    const resolveCommand = getResolveCommand();
    if (!resolveCommand) return;

    const videoElement = document.querySelector("video");
    const ytlrPlayer = document.querySelector("ytlr-player");
    const ytlrPlayerContainer = document.querySelector("ytlr-player-container");
    if (!videoElement || !ytlrPlayer || !ytlrPlayerContainer) return;

    const timestamp = Math.floor(videoElement.currentTime);
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.attributeName !== "class") return;
        if (ytlrPlayer.classList.contains("ytLrPlayerEnabled")) return;

        function setStyles() {
          ytlrPlayerContainer.style.zIndex = "10";
          ytlrPlayer.style.display = "block";
          ytlrPlayer.style.backgroundColor = "rgba(0,0,0,0)";
        }
        setStyles();
        setTimeout(setStyles, 500);

        function onPipEnter() {
          const video = document.querySelector("video");
          if (!video) return;
          video.style.removeProperty("inset");
          video.style.width = `${window.innerWidth / 3.5}px`;
          video.style.height = `${window.innerHeight / 3.5}px`;
          video.style.top = "68vh";
          video.style.left = "68vw";
          window.isPipPlaying = true;
          video.removeEventListener("play", onPipEnter);
        }

        videoElement.addEventListener("play", onPipEnter);
        observer.disconnect();
        setTimeout(() => {
          try {
            if (PlayerService && PlayerService.loadedPlaybackConfig) {
              const watchEndpoint = PlayerService.loadedPlaybackConfig.watchEndpoint;
              if (watchEndpoint) watchEndpoint.startTimeSeconds = timestamp;
              PlayerService.loadVideo(PlayerService.loadedPlaybackConfig);
            }
          } catch (e) {
            console.warn("PiP video load failed:", e);
          }
        }, 1000);
      });
    });

    observer.observe(ytlrPlayer, { attributes: true, attributeFilter: ["class"] });
    try {
      resolveCommand({ signalAction: { signal: "HISTORY_BACK" } });
    } catch (e) {
      observer.disconnect();
      throw e;
    }
  } catch (e) {
    console.error("Enable PiP failed:", e);
  }
}

function pipToFullscreen() {
  try {
    if (!PlayerService || !PlayerService.loadedPlaybackConfig) return;
    const videoElement = document.querySelector("video");
    const { clickTrackingParams, commandMetadata, watchEndpoint } = PlayerService.loadedPlaybackConfig;
    if (videoElement && watchEndpoint) watchEndpoint.startTimeSeconds = Math.floor(videoElement.currentTime);

    const resolveCommand = getResolveCommand();
    if (!resolveCommand) return;
    resolveCommand({ clickTrackingParams, commandMetadata, watchEndpoint });
    window.isPipPlaying = false;
    cleanupPipStyles();
  } catch (e) {
    console.error("PiP to fullscreen failed:", e);
  }
}

const originalClasses = {
  ytlrSearchVoice: { length: 0, classes: [] },
  ytlrSearchVoiceMicButton: { length: 0, classes: [] },
};

function initPipObserver() {
  if (observerPipEnter) return;
  if (!document.body) {
    setTimeout(initPipObserver, 100);
    return;
  }

  observerPipEnter = new MutationObserver(() => {
    if (!window.isPipPlaying) return;
    try {
      const searchBar = document.querySelector("ytlr-search-bar");
      if (!searchBar || document.querySelector("#tt-pip-button")) return;
      const voiceButton = searchBar.querySelector("ytlr-search-voice");
      if (!voiceButton || !voiceButton.children[0] || !voiceButton.children[0].children[0]) return;

      const iconClassNames = window._yttv
        ? Object.values(window._yttv).find((a) => a instanceof Map && a.has("CLEAR_COOKIES"))
        : null;
      if (!iconClassNames) return;

      const iconClassToBeRemoved = iconClassNames.get("MICROPHONE_ON");
      const iconClearCookiesClass = iconClassNames.get("CLEAR_COOKIES");
      const pipButton = document.createElement("ytlr-search-voice");

      for (let i = 0; i < voiceButton.classList.length; i++) {
        if (originalClasses.ytlrSearchVoice.length === 0) originalClasses.ytlrSearchVoice.length = voiceButton.classList.length;
        if (originalClasses.ytlrSearchVoice.length !== voiceButton.classList.length) {
          for (const className of originalClasses.ytlrSearchVoice.classes) pipButton.classList.add(className);
          break;
        }
        if (!originalClasses.ytlrSearchVoice.classes.includes(voiceButton.classList[i])) {
          originalClasses.ytlrSearchVoice.classes.push(voiceButton.classList[i]);
        }
        pipButton.classList.add(voiceButton.classList[i]);
      }

      pipButton.style.left = "10.25em";
      pipButton.id = "tt-pip-button";
      const pipButtonMicButton = document.createElement("ytlr-search-voice-mic-button");
      for (let i = 0; i < voiceButton.children[0].classList.length; i++) {
        if (originalClasses.ytlrSearchVoiceMicButton.length === 0) {
          originalClasses.ytlrSearchVoiceMicButton.length = voiceButton.children[0].classList.length;
        }
        if (originalClasses.ytlrSearchVoiceMicButton.length !== voiceButton.children[0].classList.length) {
          for (const className of originalClasses.ytlrSearchVoiceMicButton.classes) pipButtonMicButton.classList.add(className);
          break;
        }
        if (!originalClasses.ytlrSearchVoiceMicButton.classes.includes(voiceButton.children[0].classList[i])) {
          originalClasses.ytlrSearchVoiceMicButton.classes.push(voiceButton.children[0].classList[i]);
        }
        pipButtonMicButton.classList.add(voiceButton.children[0].classList[i]);
      }

      const pipIcon = document.createElement("yt-icon");
      for (let i = 0; i < voiceButton.children[0].children[0].classList.length; i++) {
        pipIcon.classList.add(voiceButton.children[0].children[0].classList[i]);
      }
      if (iconClassToBeRemoved) pipIcon.classList.remove(iconClassToBeRemoved);
      if (iconClearCookiesClass) pipIcon.classList.add(iconClearCookiesClass);

      pipButtonMicButton.appendChild(pipIcon);
      pipButton.appendChild(pipButtonMicButton);
      searchBar.appendChild(pipButton);
    } catch (e) {
      console.warn("PiP button creation failed:", e);
    }
  });

  observerPipEnter.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initPipObserver);
else initPipObserver();

export { enablePip, pipToFullscreen };
