// Loads the ad/telemetry feature modules into one vm context for Node tests.
// Each file's import lines are removed and "export" keywords dropped; the
// files then run as one script, so their top-level names resolve to each other.
// Stubs replace the browser-only dependencies (config, UI, thumbnails).
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");

const MODULES = [
  "mods/features/ads/stats.js",
  "mods/features/ads/breaker.js",
  "mods/features/ads/rules.js",
  "mods/features/ads/fallback.js",
  "mods/features/ads/player.js",
  "mods/features/ads/shelves.js",
  "mods/features/ads/responseAds.js",
  "mods/features/telemetry/endpoints.js",
  "mods/features/telemetry/hooks.js",
  "mods/features/streamFormats.js",
  "mods/features/playerNotices.js",
  "mods/features/sponsorBlockActions.js",
  "mods/features/queuedVideosShelf.js",
  "mods/features/playbackContextStringify.js",
  "mods/features/avatarQuality.js",
  "mods/features/adblock.js",
];

function bundleSource() {
  return MODULES.map((rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    return src
      .replace(/^import[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "")
      .replace(/^export\s+(?=(function|const|let|var)\b)/gm, "");
  }).join("\n;\n");
}

function loadBundle(settings, win) {
  const captured = [];
  const identity = (items) => items;
  const windowStub = Object.assign(
    { queuedVideos: { videos: [], lastVideoId: null }, sponsorblock: null, JSON, navigator: {} },
    win || {},
  );
  const ctx = vm.createContext({
    configRead: (key) => settings[key],
    timelyAction: () => ({}),
    ButtonRenderer: () => ({}),
    ShelfRenderer: () => ({}),
    TileRenderer: () => ({}),
    PatchSettings() {},
    t: (s) => s,
    hqify() {},
    deArrowify() {},
    addLongPress() {},
    addPreviews() {},
    hideVideo: identity,
    filterGuideItems: (r) => r,
    installResponsePipeline: (filters) => {
      captured.push(...filters);
    },
    window: windowStub,
    JSON,
    Promise,
    console,
  });
  vm.runInContext(bundleSource(), ctx, { filename: "adblock-bundle.js" });
  return { filters: captured, ctx, window: windowStub };
}

module.exports = { loadBundle, MODULES };
