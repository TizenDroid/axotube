// High-Quality Thumbnails for Focused Items
// Fixes issue where focused thumbnails revert to default quality

import { configRead, configChangeEmitter } from "../config.js";
import {
  extractVideoIdFromThumbnailUrl,
  hqQualityCache,
  probeBestThumbnailQuality,
} from "../shared/hqThumbnails.js";

function upgradeThumbnailQuality(element) {
  if (!configRead("enableHqThumbnails")) return;
  if (!element || element.isConnected === false) return;

  var currentUrl = "";
  var isBackgroundImage = false;

  if (element.tagName === "IMG" && element.src) {
    currentUrl = element.src;
  } else if (element.style && element.style.backgroundImage) {
    var bgMatch = element.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
    if (bgMatch && bgMatch[1]) {
      currentUrl = bgMatch[1];
      isBackgroundImage = true;
    }
  }

  if (!currentUrl || !currentUrl.includes("i.ytimg.com/vi/")) return;

  var videoId = extractVideoIdFromThumbnailUrl(currentUrl);
  if (!videoId) return;

  if (element.getAttribute("data-hq-upgraded") === videoId) return;

  var qualityMatch = currentUrl.match(
    /\/(maxresdefault|sddefault|hqdefault|mqdefault|default)\.jpg/
  );
  var currentQuality = qualityMatch ? qualityMatch[1] : "default";
  var cachedQuality = hqQualityCache[videoId];

  if (cachedQuality && currentQuality + ".jpg" === cachedQuality) {
    element.setAttribute("data-hq-upgraded", videoId);
    return;
  }

  element.setAttribute("data-hq-upgraded", videoId);

  var applyFinalQuality = function (qualityName) {
    if (!element || element.isConnected === false) return;
    var finalUrl = "https://i.ytimg.com/vi/" + videoId + "/" + qualityName;
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
  var observerConfig = {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "src", "srcset", "style"],
  };

  var findTargetsAndUpgrade = function (container) {
    if (!container) return;
    var root = container.shadowRoot || container;

    var img = root.querySelector ? root.querySelector("img") : null;
    if (!img && root !== container && container.querySelector) {
      img = container.querySelector("img");
    }
    if (img) upgradeThumbnailQuality(img);

    var bgElements = [];
    if (root.querySelectorAll) {
      bgElements = root.querySelectorAll('[style*="background-image"]');
    } else if (container.querySelectorAll) {
      bgElements = container.querySelectorAll('[style*="background-image"]');
    }
    for (var b = 0; b < bgElements.length; b++) {
      upgradeThumbnailQuality(bgElements[b]);
    }

    if (container.style && container.style.backgroundImage) {
      upgradeThumbnailQuality(container);
    }
  };

  var closestFocused = function (element) {
    var current = element;
    while (current) {
      if (current.classList && current.classList.contains("zylon-focus")) {
        return current;
      }
      if (current.closest) {
        var viaClosest = current.closest(".zylon-focus");
        if (viaClosest) return viaClosest;
      }
      var nextParent = current.parentElement;
      if (!nextParent && current.getRootNode) {
        var rootNode = current.getRootNode();
        nextParent = (rootNode && rootNode.host) || null;
      }
      current = nextParent;
    }
    return null;
  };

  var processMutations = function (mutations) {
    try {
      var focusedEl = null;
      for (var m = 0; m < mutations.length; m++) {
        var mutation = mutations[m];
        var element = mutation.target;

        if (mutation.type === "attributes" && mutation.attributeName === "class") {
          if (element.classList && element.classList.contains("zylon-focus")) {
            findTargetsAndUpgrade(element);
          }
          continue;
        }

        if (mutation.type === "attributes") {
          if (mutation.attributeName === "src" || mutation.attributeName === "srcset") {
            if (element.tagName !== "IMG") continue;
            var attr = mutation.attributeName === "src"
              ? element.getAttribute("src")
              : element.getAttribute("srcset");
            if (!attr || attr.indexOf("i.ytimg.com/vi/") === -1) continue;
          } else if (mutation.attributeName === "style") {
            var bg = element.style && element.style.backgroundImage;
            if (!bg || bg.indexOf("i.ytimg.com/vi/") === -1) continue;
          } else {
            continue;
          }

          var focusedParent = closestFocused(element);
          if (focusedParent) {
            var lockedVideoId = element.getAttribute("data-hq-upgraded");
            var liveUrl = "";
            if (element.tagName === "IMG") {
              liveUrl = element.src;
            } else if (element.style && element.style.backgroundImage) {
              var liveMatch = element.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
              liveUrl = liveMatch ? liveMatch[1] : "";
            }
            var liveVideoId = liveUrl ? extractVideoIdFromThumbnailUrl(liveUrl) : null;
            if (lockedVideoId && lockedVideoId === liveVideoId) continue;
            element.removeAttribute("data-hq-upgraded");
            upgradeThumbnailQuality(element);
          }
          continue;
        }

        if (mutation.type === "childList") {
          if (!focusedEl) focusedEl = document.querySelector(".zylon-focus");
          var upgradedOnce = false;
          for (var n = 0; n < mutation.addedNodes.length; n++) {
            var node = mutation.addedNodes[n];
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
              var focusedChildren = node.querySelectorAll(".zylon-focus");
              for (var c = 0; c < focusedChildren.length; c++) {
                findTargetsAndUpgrade(focusedChildren[c]);
              }
            }
          }
        }
      }
    } catch (err) {
      console.error("TT Error in hqObserver:", err);
    }
  };

  var observer = null;
  var pendingMutations = null;
  var pendingFrame = null;

  var startObserver = function () {
    if (observer) return;
    var container = document.getElementById("container") || document.body;
    if (!container) return;
    observer = new MutationObserver(function (mutations) {
      pendingMutations = pendingMutations ? pendingMutations.concat(mutations) : mutations;
      if (pendingFrame) return;
      pendingFrame = requestAnimationFrame(function () {
        pendingFrame = null;
        var batch = pendingMutations || [];
        pendingMutations = null;
        processMutations(batch);
      });
    });
    observer.observe(container, observerConfig);
  };

  var stopObserver = function () {
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

  var syncWithConfig = function () {
    if (configRead("enableHqThumbnails")) startObserver();
    else stopObserver();
  };

  configChangeEmitter.addEventListener("configChange", function (event) {
    if (event.detail && event.detail.key === "enableHqThumbnails") syncWithConfig();
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
