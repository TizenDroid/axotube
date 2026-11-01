// The AxoTube service's pairing code and the phone addresses it answers on. The
// web config feature fills this in; the settings panel reads it when it opens, so
// the panel always shows the current code without the user copying it anywhere.
//
// Only values of the expected shape are kept: a six-digit code and plain http(s)
// addresses. Anything else is treated as "not available".

const CODE_RE = /^\d{6}$/;
const ADDRESS_RE = /^https?:\/\/[^\s/?#]+$/;
const MAX_ADDRESSES = 4;

let info = null;
let checkedAt = 0;

export function setPairingInfo(next) {
  checkedAt = Date.now();
  if (!next || typeof next.code !== "string" || !CODE_RE.test(next.code)) {
    info = null;
    return;
  }
  const urls = Array.isArray(next.urls)
    ? next.urls.filter((url) => typeof url === "string" && ADDRESS_RE.test(url)).slice(0, MAX_ADDRESSES)
    : [];
  info = { code: next.code, urls };
}

export function getPairingInfo() {
  return info;
}

// Milliseconds since the last successful or failed check. Infinity before the first.
export function pairingInfoAge() {
  return checkedAt ? Date.now() - checkedAt : Infinity;
}
