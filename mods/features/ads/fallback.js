import { hasOwn } from "./rules.js";
import { debugLog } from "./stats.js";

// Bounded fallback search. It runs only after the known paths, and only for
// large responses, so it cannot make normal responses slower. Limits:
export const FALLBACK_MAX_DEPTH = 8;
export const FALLBACK_MAX_NODES = 2000;
export const FALLBACK_MIN_TEXT_LENGTH = 10000;

// Only exact ad keys are removed. Content items are never matched.
const ITEM_KEYS = ["adSlotRenderer", "promoShelfRenderer", "tvMastheadRenderer"];
const CLEAR_ARRAY_KEYS = ["adPlacements", "adSlots"];
const CLEAR_FLAG_KEYS = ["playerAds"];
const PLAYER_KEYS = ["attestation", "adBreakHeartbeatParams"];

function hasAnyItemKey(el) {
  for (let i = 0; i < ITEM_KEYS.length; i++) {
    if (hasOwn(el, ITEM_KEYS[i])) return true;
  }
  return false;
}

/**
 * Breadth-first walk of a parsed response. Returns { removed, nodes, truncated }.
 * opts.player: also strip player tracking keys.
 */
export function boundedAdSearch(root, opts) {
  const stripPlayer = !!(opts && opts.player);
  let removed = 0;
  let nodes = 0;
  let truncated = false;
  const queue = [{ node: root, depth: 0 }];
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
    const node = cur.node;
    if (!node || typeof node !== "object") continue;
    if (++nodes > FALLBACK_MAX_NODES) {
      truncated = true;
      break;
    }

    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        const el = node[i];
        if (el && typeof el === "object" && hasAnyItemKey(el)) {
          node.splice(i, 1);
          removed++;
        }
      }
      if (cur.depth < FALLBACK_MAX_DEPTH) {
        for (let i = 0; i < node.length; i++) {
          queue.push({ node: node[i], depth: cur.depth + 1 });
        }
      }
      continue;
    }

    for (let i = 0; i < CLEAR_ARRAY_KEYS.length; i++) {
      const key = CLEAR_ARRAY_KEYS[i];
      if (Array.isArray(node[key]) && node[key].length) {
        node[key] = [];
        removed++;
      }
    }
    for (let i = 0; i < CLEAR_FLAG_KEYS.length; i++) {
      const key = CLEAR_FLAG_KEYS[i];
      if (node[key]) {
        node[key] = false;
        removed++;
      }
    }
    if (stripPlayer) {
      for (let i = 0; i < PLAYER_KEYS.length; i++) {
        if (hasOwn(node, PLAYER_KEYS[i])) {
          delete node[PLAYER_KEYS[i]];
          removed++;
        }
      }
    }

    if (cur.depth < FALLBACK_MAX_DEPTH) {
      for (const key in node) {
        if (hasOwn(node, key) && node[key] && typeof node[key] === "object") {
          queue.push({ node: node[key], depth: cur.depth + 1 });
        }
      }
    }
  }

  if (truncated) debugLog("fallback search hit node cap", FALLBACK_MAX_NODES);
  return { removed: removed, nodes: nodes, truncated: truncated };
}
