// Classifies resolver commands that open a menu or panel over the video.
//   "popup"   a menu or dropdown (settings, playback speed, ...)
//   "reading" a panel with the description or comments (or YouChat, channel)
// Toasts are not overlays: they use the popup path, but they do not block playback.
//
// Only commands are classified here. Whether a panel is actually on screen is read
// from the page by features/panelShrink.js, because panels also close without a command.

const AXO_OPEN_ACTIONS = ["AXO_SETTINGS_SHOW", "AXO_SPEED_SETTINGS_SHOW", "SETTINGS_OPEN"];

export function classifyOverlayCommand(cmd) {
  if (!cmd || typeof cmd !== "object") return null;
  const popup = cmd.openPopupAction;
  if (popup) return popup.popupType === "TOAST" ? null : "popup";
  const panel = cmd.showEngagementPanelEndpoint;
  if (panel) return panel.customAction ? null : "reading";
  if (cmd.customAction && AXO_OPEN_ACTIONS.indexOf(cmd.customAction.action) !== -1) return "popup";
  return null;
}

export function isOverlayOpenCommand(cmd) {
  return classifyOverlayCommand(cmd) !== null;
}
