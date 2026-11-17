// High-Quality Thumbnails for Focused Items
// Fixes issue where focused thumbnails revert to default quality
//
// Two things keep this cheap and calm:
//  - It watches class and image-source changes only. Inline style changes are most of what
//    leanback's focus animations produce, and watching them made the observer run every frame
//    while the user moved through a row. A focused tile's background image is still checked
//    when that tile gets focus.
//  - A better image is loaded first, and only then shown in place of the old one, so a tile
//    does not flash to a blank or to the small image while the sharp one arrives.

import { configChangeEmitter, configRead } from "../config.js";
import { hqThumbnailMode } from "../shared/performanceMode.js";
import {
  extractVideoIdFromThumbnailUrl,
  resolveThumbnailFile,
  resolveThumbnailQuality,
} from "../shared/hqThumbnails.js";

// Marks a tile as handled for one preference and one video.
function lockFor(preferred, videoId) {
  return preferred + ":" + videoId;
}

function currentPreference() {
  return resolveThumbnailQuality(configRead("hqThumbnailQuality"));
}

// A tile is upgraded only once focus has rested on it this long. Tiles passed on the way are
// never upgraded: a new image decoded and painted in the middle of a move is the stutter.
const FOCUS_SETTLE_MS = 150;

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

  const preferred = currentPreference();
  const lock = lockFor(preferred, videoId);
  if (element.getAttribute("data-hq-upgraded") === lock) return;
  element.setAttribute("data-hq-upgraded", lock);

  let qualityMatch = currentUrl.match(/\/(maxresdefault|sddefault|hqdefault|mqdefault|default)\.jpg/);
  const currentFile = qualityMatch ? qualityMatch[1] + ".jpg" : "default.jpg";

  const applyFile = function (file) {
    if (!element || element.isConnected === false) return;
    if (file === currentFile) return;
    const finalUrl = "https://i.ytimg.com/vi/" + videoId + "/" + file;
    // resolveThumbnailFile has already loaded this image, so the swap is not seen.
    if (isBackgroundImage) {
      element.style.backgroundImage = 'url("' + finalUrl + '")';
    } else {
      element.removeAttribute("srcset");
      element.src = finalUrl;
    }
  };

  resolveThumbnailFile(videoId, preferred, applyFile, Image);
}

function initFocusObserver() {
  let observerConfig = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "src", "srcset"],
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

  let settleTimer = null;
  let settleTarget = null;
  let scheduleUpgrade = function (container) {
    settleTarget = container;
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      settleTimer = null;
      const target = settleTarget;
      settleTarget = null;
      if (!target || target.isConnected === false) return;
      const focused = document.querySelector(".zylon-focus");
      if (!focused) return;
      // Still the focused tile, or one that contains it, or one inside it.
      if (focused !== target && !target.contains(focused) && !focused.contains(target)) return;
      findTargetsAndUpgrade(target);
    }, FOCUS_SETTLE_MS);
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
      const preferred = currentPreference();
      for (let m = 0; m < mutations.length; m++) {
        let mutation = mutations[m];
        let element = mutation.target;

        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          if (element.classList && element.classList.contains("zylon-focus")) {
            scheduleUpgrade(element);
          }
          continue;
        }

        if (mutation.type === "attributes") {
          if (mutation.attributeName !== "src" && mutation.attributeName !== "srcset") continue;
          if (element.tagName !== "IMG") continue;
          let attr =
            mutation.attributeName === "src"
              ? element.getAttribute("src")
              : element.getAttribute("srcset");
          if (!attr || attr.indexOf("i.ytimg.com/vi/") === -1) continue;

          let focusedParent = closestFocused(element);
          if (focusedParent) {
            // Our own swap changes src too; a tile already upgraded for this preference and
            // video is left alone, so a swap does not start another round.
            let lockedValue = element.getAttribute("data-hq-upgraded");
            let liveVideoId = extractVideoIdFromThumbnailUrl(element.src || "");
            if (lockedValue && lockedValue === lockFor(preferred, liveVideoId)) continue;
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
                scheduleUpgrade(focusedEl);
                upgradedOnce = true;
              }
            } else if (!focusedEl && node.querySelectorAll) {
              let focusedChildren = node.querySelectorAll(".zylon-focus");
              for (let c = 0; c < focusedChildren.length; c++) {
                scheduleUpgrade(focusedChildren[c]);
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
  let syncKeys = [
    "enableHqThumbnails",
    "hqThumbnailQuality",
    "enablePerformanceMode",
    "enableReducedMotion",
    "enableLowMemoryMode",
  ];
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
