import { timelyAction, ButtonRenderer } from "../ui/ytUI.js";
import { t } from "i18next";

// SponsorBlock skip actions are added as timely actions and marked by the
// engagement-panel SKIP command. Native timely actions are kept.
function isAxotubeSponsorTimelyAction(action) {
  const buttons = action && action.timelyActionRenderer && action.timelyActionRenderer.actionButtons;
  if (!Array.isArray(buttons)) return false;
  return buttons.some(
    (button) =>
      button &&
      button.buttonRenderer &&
      button.buttonRenderer.command &&
      button.buttonRenderer.command.showEngagementPanelEndpoint &&
      button.buttonRenderer.command.showEngagementPanelEndpoint.customAction &&
      button.buttonRenderer.command.showEngagementPanelEndpoint.customAction.action === "SKIP",
  );
}

function mergeSponsorTimelyActions(renderer, axotubeActions) {
  const existing = Array.isArray(renderer.timelyActionRenderers) ? renderer.timelyActionRenderers : [];
  const nativeActions = existing.filter((action) => !isAxotubeSponsorTimelyAction(action));
  renderer.timelyActionRenderers = nativeActions.concat(axotubeActions);
}

function manualSkipActions(flags) {
  const timelyActions = [];
  const skips = flags.sponsorManualSkips;
  if (!Array.isArray(skips) || skips.length === 0 || !window?.sponsorblock?.segments) {
    return timelyActions;
  }
  for (const segment of window.sponsorblock.segments) {
    if (skips.includes(segment.category)) {
      timelyActions.push(
        timelyAction(
          t("sponsorblock.toasts.skip", { segment: t(`sponsorblock.segments.${segment.category}`) }),
          "SKIP_NEXT",
          {
            clickTrackingParams: null,
            showEngagementPanelEndpoint: {
              customAction: { action: "SKIP", parameters: { time: segment.segment[1] } },
            },
          },
          segment.segment[0] * 1000,
          segment.segment[1] * 1000 - segment.segment[0] * 1000,
        ),
      );
    }
  }
  return timelyActions;
}

export function applySponsorBlockActions(r, flags) {
  const overlayRenderer = r?.playerOverlays?.playerOverlayRenderer;
  if (overlayRenderer) mergeSponsorTimelyActions(overlayRenderer, manualSkipActions(flags));

  const promoted = r?.transportControls?.transportControlsRenderer?.promotedActions;
  if (promoted && flags.sponsorHighlight && window?.sponsorblock?.segments) {
    const category = window.sponsorblock.segments.find((seg) => seg.category === "poi_highlight");
    if (category) {
      promoted.push({
        type: "TRANSPORT_CONTROLS_BUTTON_TYPE_SPONSORBLOCK_HIGHLIGHT",
        button: {
          buttonRenderer: ButtonRenderer(false, t("sponsorblock.toasts.skipToHighlight"), "SKIP_NEXT", {
            clickTrackingParams: null,
            customAction: { action: "SKIP", parameters: { time: category.segment[0] } },
          }),
        },
      });
    }
  }
}
