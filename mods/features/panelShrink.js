// Shrinks the video while an engagement panel is on screen (description, comments,
// and the other panels that use the same shell). Only on the watch page, and only
// when enablePanelShrink is on. The size is panelShrinkPercent (50, 60 or 70).
//
// The open state is read from the page, not from commands. The probe data showed
// that Escape and other closers do not always send a command, and that panels
// overlap. But every panel uses one root element, which is removed from the DOM when
// the panel closes. While it is closing, its inner overlay gets the class "frHKed".
import { configRead, configChangeEmitter } from "../config.js";

const BODY_CLASS = "axo-panel-shrink";
const STYLE_ID = "axo-panel-shrink-style";
const PANEL_SELECTOR = "ytlr-engagement-panel-section-list-renderer";
const PANEL_INNER_SELECTOR = "ytlr-animated-overlay";
const CLOSING_CLASS = "frHKed";
const CSS = `
body.${BODY_CLASS} ytlr-player-container {
  transform: scale(var(--axo-panel-scale, 0.6));
  transform-origin: 0 0;
  transition: transform 0.25s ease;
}
`;

// Pure check on a panel root element (or null when there is no panel).
// Open: the root exists and its inner overlay is not closing.
export function engagementPanelOpen(root) {
  if (!root) return false;
  const inner = root.querySelector(PANEL_INNER_SELECTOR);
  if (!inner) return true;
  return !inner.classList.contains(CLOSING_CLASS);
}

function onWatchPage() {
  return /#\/watch/.test(location.hash || "");
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (document.head || document.documentElement).appendChild(style);
}

let lastScale = null;
let rootObserver = null;
let observedRoot = null;
let frame = null;

// Runs only while a panel can open: the watch page, with the feature on. Watching the
// container all the time meant every tile added during a browse-page scroll scheduled a sync.
let containerObserver = null;
let observedContainer = null;
function syncContainerObserver(wanted) {
  const container = wanted ? document.getElementById("container") || document.body : null;
  if (container === observedContainer && !!containerObserver === wanted) return;
  if (containerObserver) containerObserver.disconnect();
  containerObserver = null;
  observedContainer = container;
  if (!container || typeof MutationObserver === "undefined") return;
  containerObserver = new MutationObserver(scheduleSync);
  containerObserver.observe(container, { childList: true, subtree: true });
}

function sync() {
  frame = null;
  if (!document.body) return;
  const wanted = !!configRead("enablePanelShrink") && onWatchPage();
  syncContainerObserver(wanted);
  const root = wanted ? document.querySelector(PANEL_SELECTOR) : null;
  attachRootObserver(root);
  ensureStyle();

  const on = !!configRead("enablePanelShrink") && onWatchPage() && engagementPanelOpen(root);
  if (document.body.classList.contains(BODY_CLASS) !== on) document.body.classList.toggle(BODY_CLASS, on);

  const scale = String(Number(configRead("panelShrinkPercent")) / 100);
  if (scale !== lastScale) {
    lastScale = scale;
    document.documentElement.style.setProperty("--axo-panel-scale", scale);
  }
}

function scheduleSync() {
  if (frame !== null) return;
  frame = requestAnimationFrame(sync);
}

// Watches the panel root's own class changes, which is where "closing" appears.
function attachRootObserver(root) {
  if (root === observedRoot) return;
  if (rootObserver) rootObserver.disconnect();
  rootObserver = null;
  observedRoot = root;
  if (!root || typeof MutationObserver === "undefined") return;
  rootObserver = new MutationObserver(scheduleSync);
  rootObserver.observe(root, { subtree: true, attributes: true, attributeFilter: ["class"] });
}

function start() {
  if (!document.body) {
    setTimeout(start, 250);
    return;
  }
  window.addEventListener("hashchange", scheduleSync);
  configChangeEmitter.addEventListener("configChange", (event) => {
    const key = event.detail && event.detail.key;
    if (key === "enablePanelShrink" || key === "panelShrinkPercent") scheduleSync();
  });
  sync();
}
start();
