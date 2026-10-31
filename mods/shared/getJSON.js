// JSON GET over XMLHttpRequest, for features that call third-party APIs.
//
// fetch() is avoided here on purpose: the fetch on Chromium 47-56 ignores
// AbortSignal, so a request started by a video that is closed a moment later
// keeps its socket and response buffer until the server answers. XHR can be
// aborted on every engine we target, and its timeout is native, so no timer
// or promise is left behind when the caller gives up.
//
// Returns { promise, abort }. A 404 resolves to null ("no data"); other
// failures reject. abort() rejects the promise with an "aborted" error.
export function getJSON(url, timeoutMs) {
  let xhr = null;

  const promise = new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.timeout = timeoutMs;

    xhr.onload = function () {
      if (xhr.status === 404) return resolve(null);
      if (xhr.status < 200 || xhr.status >= 300) {
        return reject(new Error(`HTTP ${xhr.status} for ${url}`));
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (err) {
        reject(err);
      }
    };
    xhr.onerror = function () {
      reject(new Error(`network error for ${url}`));
    };
    xhr.ontimeout = function () {
      reject(new Error(`timed out after ${timeoutMs}ms for ${url}`));
    };
    xhr.onabort = function () {
      reject(new Error("aborted"));
    };

    xhr.send();
  });

  return {
    promise,
    abort() {
      if (xhr && xhr.readyState !== 4) xhr.abort();
    },
  };
}
