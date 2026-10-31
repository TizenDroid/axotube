// High-Quality Thumbnails for Focused Items
// Fixes issue where focused thumbnails revert to default quality

import { configChangeEmitter } from "../config.js";
import { hqThumbnailMode } from "../shared/performanceMode.js";
import {
  extractVideoIdFromThumbnailUrl,
  hqQualityCache,
  probeBestThumbnailQuality,
} from "../shared/hqThumbnails.js";

function upgradeThumbnailQuality(element) {
  if (hqThumbnailMode() === "off") return;
  if (!element || element.isConnected === false) return;

  let currentUrl = "";
  let isBackgroundImage = false;

  if (element.tagName === "IMG" && element.src) {
    currentUrl = element.src;
  } else if (element.style && element.style.backgroundImage) {
    let bgMatch = element.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
    if (bgMatch && bgMatch[1]) {
      currentUrl = bgMatch[1];
      isBackgroundImage = true;
    }
  }

  if (!currentUrl || !currentUrl.includes("i.ytimg.com/vi/")) return;

  let videoId = extractVideoIdFromThumbnailUrl(currentUrl);
  if (!videoId) return;

  if (element.getAttribute("data-hq-upgraded") === videoId) return;

  let qualityMatch = currentUrl.match(
    /\/(maxresdefault|sddefault|hqdefault|mqdefault|default)\.jpg/,
  );
  let currentQuality = qualityMatch ? qualityMatch[1] : "default";
  let cachedQuality = hqQualityCache.get(videoId);

  if (cachedQuality && currentQuality + ".jpg" === cachedQuality) {
    element.setAttribute("data-hq-upgraded", videoId);
    return;
  }

  element.setAttribute("data-hq-upgraded", videoId);

  let applyFinalQuality = function (qualityName) {
    if (!element || element.isConnected === false) return;
    let finalUrl = "https://i.ytimg.com/vi/" + videoId + "/" + qualityName;
    if (isBackgroundImage) {
      element.style.backgroundImage = 'url("' + finalUrl + '")';
    } else {
      element.removeAttribute("srcset");
      element.src = finalUrl;
    }
  };

  if (cachedQuality) {
    applyFinalQuality(cachedQuality);
    return;
  }

  probeBestThumbnailQuality(videoId, function (qualityName) {
    applyFinalQuality(qualityName);
  });
}

function initFocusObserver() {
  let observerConfig = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "src", "srcset", "style"],
  };

  let findTargetsAndUpgrade = function (container) {
    if (!container) return;
    let root = container.shadowRoot || container;

    let img = root.querySelector ? root.querySelector("img") : null;
    if (!img && root !== container && container.querySelector) {
      img = container.querySelector("img");
    }
    if (img) upgradeThumbnailQuality(img);

    let bgElements = [];
    if (root.querySelectorAll) {
      bgElements = root.querySelectorAll('[style*="background-image"]');
    } else if (container.querySelectorAll) {
      bgElements = container.querySelectorAll('[style*="background-image"]');
    }
    for (let b = 0; b < bgElements.length; b++) {
      upgradeThumbnailQuality(bgElements[b]);
    }

    if (container.style && container.style.backgroundImage) {
      upgradeThumbnailQuality(container);
    }
  };

  let closestFocused = function (element) {
    let current = element;
    while (current) {
      if (current.classList && current.classList.contains("zylon-focus")) {
        return current;
      }
      if (current.closest) {
        let viaClosest = current.closest(".zylon-focus");
        if (viaClosest) return viaClosest;
      }
      let nextParent = current.parentElement;
      if (!nextParent && current.getRootNode) {
        let rootNode = current.getRootNode();
        nextParent = (rootNode && rootNode.host) || null;
      }
      current = nextParent;
    }
    return null;
  };

  let processMutations = function (mutations) {
    try {
      let focusedEl = null;
      for (let m = 0; m < mutations.length; m++) {
        let mutation = mutations[m];
        let element = mutation.target;

        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          if (element.classList && element.classList.contains("zylon-focus")) {
            findTargetsAndUpgrade(element);
          }
          continue;
        }

        if (mutation.type === "attributes") {
          if (mutation.attributeName === "src" || mutation.attributeName === "srcset") {
            if (element.tagName !== "IMG") continue;
            let attr =
              mutation.attributeName === "src"
                ? element.getAttribute("src")
                : element.getAttribute("srcset");
            if (!attr || attr.indexOf("i.ytimg.com/vi/") === -1) continue;
          } else if (mutation.attributeName === "style") {
            let bg = element.style && element.style.backgroundImage;
            if (!bg || bg.indexOf("i.ytimg.com/vi/") === -1) continue;
          } else {
            continue;
          }

          let focusedParent = closestFocused(element);
          if (focusedParent) {
            let lockedVideoId = element.getAttribute("data-hq-upgraded");
            let liveUrl = "";
            if (element.tagName === "IMG") {
              liveUrl = element.src;
            } else if (element.style && element.style.backgroundImage) {
              let liveMatch = element.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
              liveUrl = liveMatch ? liveMatch[1] : "";
            }
            let liveVideoId = liveUrl ? extractVideoIdFromThumbnailUrl(liveUrl) : null;
            if (lockedVideoId && lockedVideoId === liveVideoId) continue;
            element.removeAttribute("data-hq-upgraded");
            upgradeThumbnailQuality(element);
          }
          continue;
        }

        if (mutation.type === "childList") {
          if (!focusedEl) focusedEl = document.querySelector(".zylon-focus");
          let upgradedOnce = false;
          for (let n = 0; n < mutation.addedNodes.length; n++) {
            let node = mutation.addedNodes[n];
            if (node.nodeType !== 1) continue;

            if (
              focusedEl &&
              (focusedEl === node || focusedEl.contains(node) || node.contains(focusedEl))
            ) {
              if (!upgradedOnce) {
                findTargetsAndUpgrade(focusedEl);
                upgradedOnce = true;
              }
            } else if (!focusedEl && node.querySelectorAll) {
              let focusedChildren = node.querySelectorAll(".zylon-focus");
              for (let c = 0; c < focusedChildren.length; c++) {
                findTargetsAndUpgrade(focusedChildren[c]);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("[AxoTube:hqThumbnailsFocusObserver] Focus handling failed:", err);
    }
  };

  let observer = null;
  let pendingMutations = null;
  let pendingFrame = null;

  let startObserver = function () {
    if (observer) return;
    let container = document.getElementById("container") || document.body;
    if (!container) return;
    observer = new MutationObserver(function (mutations) {
      pendingMutations = pendingMutations ? pendingMutations.concat(mutations) : mutations;
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(function () {
        pendingFrame = null;
        let batch = pendingMutations || [];
        pendingMutations = null;
        processMutations(batch);
      });
    });
    observer.observe(container, observerConfig);
  };

  let stopObserver = function () {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (pendingFrame) {
      cancelAnimationFrame(pendingFrame);
      pendingFrame = null;
    }
    pendingMutations = null;
  };

  let syncWithConfig = function () {
    if (hqThumbnailMode() !== "off") startObserver();
    else stopObserver();
  };

  // Performance-mode switches change the thumbnail mode, so they re-sync too.
  let syncKeys = ["enableHqThumbnails", "enablePerformanceMode", "enableReducedMotion", "enableLowMemoryMode"];
  configChangeEmitter.addEventListener("configChange", function (event) {
    if (event.detail && syncKeys.indexOf(event.detail.key) !== -1) syncWithConfig();
  });

  syncWithConfig();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(initFocusObserver, 1000);
  });
} else {
  setTimeout(initFocusObserver, 1000);
}
