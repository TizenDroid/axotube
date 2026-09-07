// Cast receiver. When a phone casts to the TV, the TizenBrew standalone app
// loads this module's appPath with the cast payload appended as URL query
// params. This module maps those params to a resolveCommand payload and waits
// for a real YouTube resolver before dispatching it.
import resolveCommand from "../resolveCommand.js";

function parseQuery(queryString) {
  if (!queryString || queryString.length <= 1) return {};
  const params = {};
  const pairs = queryString.substring(1).split("&");
  for (let i = 0; i < pairs.length; i += 1) {
    const pair = pairs[i];
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq === -1) {
      params[decodeURIComponent(pair.replace(/\+/g, " "))] = "";
      continue;
    }
    const key = decodeURIComponent(pair.substring(0, eq).replace(/\+/g, " "));
    const value = decodeURIComponent(pair.substring(eq + 1).replace(/\+/g, " "));
    params[key] = value;
  }
  return params;
}

function buildCommand(params) {
  if (!params || typeof params !== "object") return null;
  if (params.v) {
    const watch = { videoId: params.v };
    if (params.list) watch.playlistId = params.list;
    return { watchEndpoint: watch };
  }
  if (params.list) return { playlistEndpoint: { playlistId: params.list } };
  const query = params.search_query || params.q;
  if (query) return { searchEndpoint: { query } };
  if (params.browseId) return { browseEndpoint: { browseId: params.browseId } };
  return null;
}

function canDispatch() {
  if (typeof window === "undefined" || !window._yttv) return false;
  try {
    for (const key in window._yttv) {
      const candidate = window._yttv[key];
      if (candidate && candidate.instance && typeof candidate.instance.resolveCommand === "function") {
        return true;
      }
    }
  } catch (err) {}
  return false;
}

function dispatchWhenReady(cmd) {
  if (!cmd) return;
  const dispatch = () => {
    try {
      resolveCommand(cmd);
    } catch (err) {}
  };

  if (canDispatch()) {
    dispatch();
    return;
  }

  let attempts = 0;
  const interval = setInterval(() => {
    attempts += 1;
    const ready = canDispatch();
    if (ready || attempts > 50) {
      clearInterval(interval);
      if (ready) dispatch();
    }
  }, 200);
}

try {
  const params = parseQuery(location.search);
  dispatchWhenReady(buildCommand(params));
} catch (err) {}
