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
let pipLoadTimer = null;
let pipLoadAttempts = 0;
let pipUiObserver = null;
let pipEntryObserver = null;
const pipTransitionTimers = [];
const MAX_PIP_LOAD_ATTEMPTS = 120;
const originalClasses = {
  ytlrSearchVoice: { length: 0, classes: [] },
  ytlrSearchVoiceMicButton: { length: 0, classes: [] },
};

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

function rememberPipTimer(callback, delay) {
  const timer = setTimeout(() => {
    const index = pipTransitionTimers.indexOf(timer);
    if (index !== -1) pipTransitionTimers.splice(index, 1);
    callback();
  }, delay);
  pipTransitionTimers.push(timer);
  return timer;
}

function clearPipTransitionTimers() {
  while (pipTransitionTimers.length) clearTimeout(pipTransitionTimers.pop());
}

function copyCompatibleClasses(source, target, memory) {
  if (!source || !source.classList || !target) return;
  if (memory.length === 0) memory.length = source.classList.length;

  if (memory.length !== source.classList.length && memory.classes.length) {
    for (const className of memory.classes) target.classList.add(className);
    return;
  }

  for (let i = 0; i < source.classList.length; i++) {
    const className = source.classList[i];
    if (!memory.classes.includes(className)) memory.classes.push(className);
    target.classList.add(className);
  }
}

function ensurePipButton() {
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
    copyCompatibleClasses(voiceButton, pipButton, originalClasses.ytlrSearchVoice);
    pipButton.style.left = "10.25em";
    pipButton.id = "tt-pip-button";

    const pipButtonMicButton = document.createElement("ytlr-search-voice-mic-button");
    copyCompatibleClasses(
      voiceButton.children[0],
      pipButtonMicButton,
      originalClasses.ytlrSearchVoiceMicButton,
    );

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
}

function startPipUiObserver() {
  if (pipUiObserver || !window.isPipPlaying || !document.body) return;
  pipUiObserver = new MutationObserver(() => {
    if (!window.isPipPlaying) {
      stopPipUiObserver();
      return;
    }
    ensurePipButton();
  });
  pipUiObserver.observe(document.body, { childList: true, subtree: true });
  ensurePipButton();
}

function stopPipUiObserver() {
  if (pipUiObserver) {
    pipUiObserver.disconnect();
    pipUiObserver = null;
  }
  const button = document.querySelector("#tt-pip-button");
  if (button && button.parentNode) button.parentNode.removeChild(button);
}

function cleanupPipStyles() {
  clearPipTransitionTimers();
  if (pipEntryObserver) {
    pipEntryObserver.disconnect();
    pipEntryObserver = null;
  }
  stopPipUiObserver();

  const video = document.querySelector("video");
  if (video) {
    ["width", "height", "top", "left", "inset"].forEach((p) => video.style.removeProperty(p));
  }
  const player = document.querySelector("ytlr-player");
  if (player) {
    player.style.removeProperty("display");
    player.style.removeProperty("background-color");
  }
  const container = document.querySelector("ytlr-player-container");
  if (container) container.style.removeProperty("z-index");
}

function enablePip() {
  if (!PlayerService && !pipLoad()) {
    let attempts = 0;
    const retry = () => {
      attempts += 1;
      if (PlayerService || pipLoad()) enablePip();
      else if (attempts < 20) rememberPipTimer(retry, 200);
    };
    rememberPipTimer(retry, 200);
    return;
  }

  try {
    const resolveCommand = getResolveCommand();
    if (!resolveCommand) return;

    const videoElement = document.querySelector("video");
    const ytlrPlayer = document.querySelector("ytlr-player");
    const ytlrPlayerContainer = document.querySelector("ytlr-player-container");
    if (!videoElement || !ytlrPlayer || !ytlrPlayerContainer) return;

    cleanupPipStyles();
    const timestamp = Math.floor(videoElement.currentTime);
    pipEntryObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName !== "class") continue;
        if (ytlrPlayer.classList.contains("ytLrPlayerEnabled")) continue;

        function setStyles() {
          if (!ytlrPlayer.isConnected || !ytlrPlayerContainer.isConnected) return;
          ytlrPlayerContainer.style.zIndex = "10";
          ytlrPlayer.style.display = "block";
          ytlrPlayer.style.backgroundColor = "rgba(0,0,0,0)";
        }
        setStyles();
        rememberPipTimer(setStyles, 500);

        function onPipEnter() {
          const video = document.querySelector("video");
          if (!video) return;
          video.style.removeProperty("inset");
          video.style.width = `${window.innerWidth / 3.5}px`;
          video.style.height = `${window.innerHeight / 3.5}px`;
          video.style.top = "68vh";
          video.style.left = "68vw";
          window.isPipPlaying = true;
          startPipUiObserver();
          video.removeEventListener("play", onPipEnter);
        }

        videoElement.addEventListener("play", onPipEnter);
        if (pipEntryObserver) {
          pipEntryObserver.disconnect();
          pipEntryObserver = null;
        }
        rememberPipTimer(() => {
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
        break;
      }
    });

    pipEntryObserver.observe(ytlrPlayer, { attributes: true, attributeFilter: ["class"] });
    try {
      resolveCommand({ signalAction: { signal: "HISTORY_BACK" } });
    } catch (e) {
      cleanupPipStyles();
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

export { enablePip, pipToFullscreen, cleanupPipStyles, startPipUiObserver, stopPipUiObserver };
