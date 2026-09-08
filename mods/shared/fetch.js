// Shared fetch helpers. Network-calling features (DeArrow, SponsorBlock,
// web config, updater) reuse this deadline wrapper. The Promise.race deadline
// is intentional: old Tizen/Cobalt may expose fetch without abortable-fetch
// support, so AbortController alone is not a reliable timeout there.

export const FETCH_TIMEOUT = 5000;

export function createFetchWithTimeout(timeout) {
  return function (url, options = {}) {
    let controller = null;
    try {
      if (typeof AbortController === "function") controller = new AbortController();
    } catch (e) {}

    const requestOptions = controller
      ? { ...options, signal: controller.signal }
      : options;
    let timeoutId = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        try {
          if (controller) controller.abort();
        } catch (e) {}
        reject(new Error(`Fetch timed out after ${timeout}ms`));
      }, timeout);
    });

    return Promise.race([fetch(url, requestOptions), timeoutPromise]).finally(() => {
      if (timeoutId !== null) clearTimeout(timeoutId);
    });
  };
}

export const fetchWithTimeout = createFetchWithTimeout(FETCH_TIMEOUT);