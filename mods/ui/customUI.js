// Custom UI for video player
import { t } from "i18next";
import { extractAssignedFunctions } from "../utils/ASTParser.js";
import { configRead, configChangeEmitter } from "../config.js";
import { ButtonRenderer } from "./ytUI.js";

const FEATURED_ACTION = "TRANSPORT_CONTROLS_BUTTON_TYPE_FEATURED_ACTION";
const CONTAINER_MARKER = "YtlrPlayerActionsContainer";
// fn -> bit flags (1: has FEATURED_ACTION, 2: has CONTAINER_MARKER). A function's
// source never changes, so each one is stringified once across scans and retries.
const fnFlagCache = new WeakMap();
let customUIInitialized = false;
let containerRef = null;
let retryTimer = null;
let attempts = 0;
const MAX_ATTEMPTS = 10;

function safeRead(node, key) {
  try {
    return { ok: true, value: node[key] };
  } catch (e) {
    return { ok: false, value: undefined };
  }
}

function findPlayer() {
  return document.querySelector(".html5-video-player") || document.querySelector("ytlr-player");
}

function makeRef(host, key, fn, isMap) {
  if (!host || key === undefined || typeof fn !== "function") return null;
  return {
    host,
    key,
    fn,
    write(replacement) {
      try {
        if (isMap) {
          host.set(key, replacement);
          return host.get(key) === replacement;
        }
        host[key] = replacement;
        return host[key] === replacement;
      } catch (e) {
        return false;
      }
    },
  };
}

function deepFindContainer(maxNodes, strict) {
  const marker = CONTAINER_MARKER;
  let visited = 0;
  const seen = new WeakSet();

  function matches(fn) {
    if (visited > maxNodes || typeof fn !== "function") return false;
    visited += 1;
    let flags = fnFlagCache.get(fn);
    if (flags === undefined) {
      flags = 0;
      try {
        const src = fn.toString();
        if (src.includes(FEATURED_ACTION)) flags |= 1;
        if (src.includes(marker)) flags |= 2;
      } catch (e) {}
      fnFlagCache.set(fn, flags);
    }
    return (flags & 1) !== 0 && (!strict || (flags & 2) !== 0);
  }

  function walk(node, depth, owner, ownerKey, ownerIsMap) {
    if (!node || depth > 8 || visited > maxNodes) return null;
    if ((typeof node === "object" || typeof node === "function")) {
      if (seen.has(node)) return null;
      seen.add(node);
    }

    if (typeof node === "function") {
      if (matches(node)) {
        const ref = makeRef(owner, ownerKey, node, ownerIsMap);
        if (ref) return ref;
      }
      const proto = node.prototype;
      if (proto && typeof proto === "object") return walk(proto, depth + 1, null, undefined, false);
      return null;
    }

    if (typeof node !== "object") return null;

    if (node instanceof Map) {
      for (const [k, v] of node.entries()) {
        if (visited > maxNodes) return null;
        const r = walk(v, depth + 1, node, k, true);
        if (r) return r;
      }
      return null;
    }

    if (node instanceof Set) {
      for (const v of node.values()) {
        if (visited > maxNodes) return null;
        const r = walk(v, depth + 1, null, undefined, false);
        if (r) return r;
      }
      return null;
    }

    const markerRead = safeRead(node, marker);
    if (markerRead.ok && markerRead.value !== undefined) {
      const r = walk(markerRead.value, depth + 1, node, marker, false);
      if (r) return r;
    }

    const keys = Object.keys(node);
    for (const k of keys) {
      if (visited > maxNodes) return null;
      if (k === marker) continue;
      const read = safeRead(node, k);
      if (!read.ok) continue;
      const r = walk(read.value, depth + 1, node, k, false);
      if (r) return r;
    }
    return null;
  }

  return walk(window._yttv, 0, null, undefined, false);
}

function getContainerClass() {
  if (containerRef && typeof containerRef.fn === "function") return containerRef;
  containerRef = deepFindContainer(20000, true) || deepFindContainer(20000, false);
  return containerRef;
}

function applyPatches() {
  if (customUIInitialized || !configRead("enablePatchingVideoPlayer")) return false;
  if (!window._yttv || !findPlayer()) return false;

  const ref = getContainerClass();
  if (!ref || typeof ref.write !== "function") return false;

  try {
    const origMethod = ref.fn;
    // The original's source never changes, so its class check and assignment
    // analysis run once (on first construction), not for every instance.
    let origSource = null;
    let origIsClass = false;
    let assignedFunctions = null;

    function YtlrPlayerActionsContainer() {
      const args = Array.prototype.slice.call(arguments);
      if (origSource === null) {
        origSource = origMethod.toString();
        origIsClass = /^class\s/.test(origSource);
      }
      const isClass = origIsClass;

      function constructAsNew(ctor, argsList) {
        if (typeof Reflect !== "undefined" && typeof Reflect.construct === "function") {
          return Reflect.construct(ctor, argsList, YtlrPlayerActionsContainer);
        }
        return new origMethod(...argsList);
      }

      if (!(this instanceof YtlrPlayerActionsContainer)) {
        if (isClass) return constructAsNew(origMethod, args);
        return origMethod.apply(this, args);
      }

      let inst;
      if (isClass) inst = constructAsNew(origMethod, args);
      else {
        origMethod.apply(this, args);
        inst = this;
      }

      try {
        const functions = assignedFunctions || (assignedFunctions = extractAssignedFunctions(origSource));
        const pipCommand = {
          type: "TRANSPORT_CONTROLS_BUTTON_TYPE_PIP",
          button: {
            buttonRenderer: ButtonRenderer(
              false,
              configRead("enableSwapMPWithPIP") ? t("player.pictureInPicture") : t("player.miniPlayer"),
              "CLEAR_COOKIES",
              {
                customAction: {
                  action: configRead("enableSwapMPWithPIP") ? "ENTER_PIP" : "ENTER_MP",
                },
              },
            ),
          },
        };

        const settingActionGroup = functions
          .find((func) => func.rhs.includes("TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS"))
          ?.left?.split(".")[1];

        if (settingActionGroup && configRead("enableMPButton")) {
          const origSettingActionGroup = inst[settingActionGroup];
          if (typeof origSettingActionGroup === "function") {
            inst[settingActionGroup] = function () {
              const res = origSettingActionGroup.apply(this, arguments);
              if (Array.isArray(res) && !res.find((item) => item.type === "TRANSPORT_CONTROLS_BUTTON_TYPE_PIP")) {
                const settingsIdx = res.findIndex((item) => item.type === "TRANSPORT_CONTROLS_BUTTON_TYPE_PLAYBACK_SETTINGS");
                if (settingsIdx !== -1) res.splice(settingsIdx, 0, pipCommand);
              }
              return res;
            };
          }
        }

        const previousButtonName = functions
          .find((func) => {
            if (!func.rhs.includes("skipNextButton")) return false;
            return func.rhs.indexOf("skipPreviousButton") > func.rhs.indexOf("skipNextButton");
          })
          ?.left?.split(".")[1];

        const nextButtonName = functions
          .find((func) => {
            if (!func.rhs.includes("skipPreviousButton")) return false;
            return func.rhs.indexOf("skipNextButton") > func.rhs.indexOf("skipPreviousButton");
          })
          ?.left?.split(".")[1];

        const engagementActionButton = functions
          .find((func) => func.rhs.includes("props.data.engagementActions"))
          ?.left?.split(".")[1];

        if (engagementActionButton && configRead("enableSpeedControlsButton")) {
          const origEngagementActionButton = inst[engagementActionButton];
          if (typeof origEngagementActionButton === "function") {
            inst[engagementActionButton] = function () {
              const res = origEngagementActionButton.apply(this, arguments);
              if (Array.isArray(res) && !res.find((item) => item.type === "TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED")) {
                res.push({
                  type: "TRANSPORT_CONTROLS_BUTTON_TYPE_SPEED",
                  button: {
                    buttonRenderer: ButtonRenderer(false, t("player.speedControls"), "SLOW_MOTION_VIDEO", {
                      customAction: { action: "TT_SPEED_SETTINGS_SHOW" },
                    }),
                  },
                });
              }
              return res;
            };
          }
        }

        if (!configRead("enableSuperThanksButton") && engagementActionButton) {
          const currentEngagementActionButton = inst[engagementActionButton];
          if (typeof currentEngagementActionButton === "function") {
            inst[engagementActionButton] = function () {
              const res = currentEngagementActionButton.apply(this, arguments);
              if (!Array.isArray(res)) return res;
              return res.filter(
                (item) =>
                  item.type !== "TRANSPORT_CONTROLS_BUTTON_TYPE_SUPER_THANKS" &&
                  item.type !== "TRANSPORT_CONTROLS_BUTTON_TYPE_SHOPPING",
              );
            };
          }
        }

        if (configRead("enablePreviousNextButtons") && previousButtonName && nextButtonName) {
          inst[previousButtonName] = function () {
            return ButtonRenderer(false, t("player.previous"), "SKIP_PREVIOUS", {
              signalAction: { signal: "PLAYER_PLAY_PREVIOUS" },
            });
          };
          inst[nextButtonName] = function () {
            return ButtonRenderer(false, t("player.next"), "SKIP_NEXT", {
              signalAction: { signal: "PLAYER_PLAY_NEXT" },
            });
          };
        }
      } catch (e) {
        console.warn("Custom UI patching failed:", e);
      }

      return inst;
    }

    YtlrPlayerActionsContainer.prototype = origMethod.prototype;
    if (!ref.write(YtlrPlayerActionsContainer)) {
      containerRef = null;
      return false;
    }
    ref.fn = YtlrPlayerActionsContainer;
    customUIInitialized = true;
    return true;
  } catch (e) {
    console.error("Custom UI apply failed:", e);
    containerRef = null;
    return false;
  }
}

function schedulePatchRetry(reset) {
  if (customUIInitialized || !configRead("enablePatchingVideoPlayer")) return;
  if (reset) attempts = 0;
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    attempts += 1;
    if (applyPatches()) return;
    if (attempts < MAX_ATTEMPTS) schedulePatchRetry(false);
  }, 500);
}

function startPatching() {
  if (applyPatches()) return;
  schedulePatchRetry(true);
}

if (document.readyState === "complete" || document.readyState === "interactive") startPatching();
else window.addEventListener("DOMContentLoaded", startPatching);

configChangeEmitter.addEventListener("configChange", (event) => {
  if (event.detail?.key === "enablePatchingVideoPlayer" && event.detail.value) {
    containerRef = null;
    schedulePatchRetry(true);
  }
});
