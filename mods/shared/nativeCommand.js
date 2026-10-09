// The only adapter for YouTube TV's native command resolver. Keep this module
// independent of UI and feature modules so they can use it without import cycles.
let cachedRegistry = null;
let cachedKey = null;
let cachedRoot = null;
let cachedInstance = null;
let resolverPatcher = null;
let patchWatchTimer = null;

function registry() {
  try {
    return typeof window === "undefined" ? null : window._yttv || null;
  } catch (e) {
    return null;
  }
}

function inspectRoot(roots, key) {
  try {
    const root = roots[key];
    const instance = root && root.instance;
    if (instance && typeof instance.resolveCommand === "function") {
      return { root, instance };
    }
  } catch (e) {
    // Some host entries have getters that throw on older YouTube builds.
  }
  return null;
}

function applyPatch(instance) {
  if (!resolverPatcher) return;
  try {
    resolverPatcher(instance);
  } catch (e) {
    // A patch failure must not prevent native commands from being dispatched.
  }
}

function findResolver() {
  const roots = registry();
  if (roots) {
    if (roots === cachedRegistry && cachedRoot !== null) {
      const cached = inspectRoot(roots, cachedKey);
      if (cached && cached.root === cachedRoot && cached.instance === cachedInstance) {
        applyPatch(cached.instance);
        return cached.instance;
      }
    }

    cachedRegistry = roots;
    cachedRoot = null;
    cachedInstance = null;
    cachedKey = null;
    try {
      for (const key in roots) {
        const found = inspectRoot(roots, key);
        if (!found) continue;
        cachedKey = key;
        cachedRoot = found.root;
        cachedInstance = found.instance;
        applyPatch(found.instance);
        return found.instance;
      }
    } catch (e) {
      // A broken registry must not break the TV's command processing.
    }
  }

  // Some TizenBrew hosts provide their own callable resolver before _yttv.
  // The receiver remains window when dispatched through this fallback.
  try {
    if (typeof window !== "undefined" && typeof window._yttv_resolveCommand === "function") {
      return { resolveCommand: function (command, context) {
        return window._yttv_resolveCommand(command, context);
      } };
    }
  } catch (e) {}
  return null;
}

/** True only when an actual callable native resolver is available. */
export function hasNativeResolver() {
  return !!findResolver();
}

/**
 * Dispatch once with the native instance as `this`. Absence is reported
 * separately: a native resolver can successfully return undefined.
 * Native exceptions propagate without another dispatch attempt.
 */
export function tryDispatchNativeCommand(command, context) {
  const instance = findResolver();
  if (!instance) return { dispatched: false };
  return { dispatched: true, result: instance.resolveCommand(command, context) };
}

/** Compatibility interface for existing callers that expect the native result. */
export function dispatchNativeCommand(command, context) {
  return tryDispatchNativeCommand(command, context).result;
}

/**
 * Wait at most maxAttempts * retryDelayMs for a resolver, then invoke once.
 * Resolves false only if no callable resolver becomes available (safe to retry).
 * Once invoked, resolves true even if the native method returns undefined or
 * throws: the command may already have had side effects before throwing.
 * A caller using queued command IDs should ACK attempted calls to avoid replay.
 * This favors at-most-once execution over guaranteed completion.
 */
export function dispatchNativeCommandWhenReady(command, options = {}) {
  if (!command) return Promise.resolve(false);
  const maxAttempts = options.maxAttempts === undefined ? 50 : options.maxAttempts;
  const retryDelayMs = options.retryDelayMs === undefined ? 200 : options.retryDelayMs;
  return new Promise((resolve) => {
    let attempts = 0;
    function attempt() {
      const instance = findResolver();
      if (instance) {
        try {
          // The invocation boundary is crossed here. Its return value does
          // not tell us whether the command already changed native state.
          instance.resolveCommand(command);
          resolve(true);
        } catch (e) {
          // Even a thrown native method may already have acted. ACK this
          // attempt instead of executing the same queued command again.
          try {
            console.warn("axotube: native command threw after dispatch attempt; not retrying", e);
          } catch (ignored) {}
          resolve(true);
        }
        return;
      }
      if (attempts >= maxAttempts) {
        resolve(false);
        return;
      }
      attempts += 1;
      setTimeout(attempt, retryDelayMs);
    }
    attempt();
  });
}

/**
 * Register the command transformer once. It is applied to every discovered
 * native instance, including replacement instances found by later dispatches.
 */
export function registerNativeResolverPatcher(patcher) {
  resolverPatcher = patcher;
  return refreshNativeResolverPatches();
}

/** Refresh all resolver instances, including those not selected by the cache. */
export function refreshNativeResolverPatches() {
  const roots = registry();
  if (!roots) return false;
  let found = false;
  try {
    for (const key in roots) {
      const entry = inspectRoot(roots, key);
      if (!entry) continue;
      found = true;
      applyPatch(entry.instance);
    }
  } catch (e) {}
  return found;
}

/** Observe native replacement roots without running discovery on every frame. */
export function watchNativeResolverPatches() {
  if (patchWatchTimer !== null) return;
  patchWatchTimer = setInterval(refreshNativeResolverPatches, 2000);
}
