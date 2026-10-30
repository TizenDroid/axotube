// Update popup. The standalone proxy (localhost:8099) compares the bundle in use
// with the latest published one (standalone/service/bundleUpdates.js). This
// module asks the proxy and shows the popup. Applying an update re-checks in the
// proxy and reloads the page, which picks up the new bundles. Outside the standalone app
// there is no proxy, the request fails, and nothing is shown.
import { t } from "i18next";
import { buttonItem, showModal, showToast, overlayPanelItemListRenderer } from "../ui/ytUI.js";
import { configRead } from "../config.js";

const REMIND_LATER_S = 86400;
const BOOT_CHECK_DELAY_MS = 3000;

function proxyUrl(path) {
  const origin = window.location && window.location.origin ? window.location.origin : "http://localhost:8099";
  return origin + path;
}

function showUpdatePopup(status) {
  const currentEpoch = Math.floor(Date.now() / 1000);
  showModal(
    {
      title: t("updater.modalTitle"),
      subtitle: t("updater.modalBodyNew", { latest: status.latest, current: status.current }),
    },
    overlayPanelItemListRenderer([
      buttonItem(
        {
          title: t("updater.updateNow"),
          subtitle: t("updater.updateNowSubtitle"),
        },
        { icon: "DOWN_ARROW" },
        [
          { customAction: { action: "AXO_UPDATE_APPLY", parameters: status.latest } },
          { signalAction: { signal: "POPUP_BACK" } },
        ],
      ),
      buttonItem(
        {
          title: t("updater.remindLater"),
          subtitle: t("updater.remindLaterSubtitle"),
        },
        { icon: "SEARCH_HISTORY" },
        [
          {
            customAction: {
              action: "UPDATE_REMIND_LATER",
              parameters: currentEpoch + REMIND_LATER_S,
            },
          },
          { signalAction: { signal: "POPUP_BACK" } },
        ],
      ),
    ]),
    "axo-update-modal",
    false,
  );
}

// Asks the proxy whether a newer bundle exists. Manual checks always report a
// result; the automatic check on load stays quiet unless an update is available.
function checkForUpdates(showNoUpdateToast) {
  fetch(proxyUrl("/axotube/update"), { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error("update status HTTP " + response.status);
      return response.json();
    })
    .then((status) => {
      if (status.available) {
        showUpdatePopup(status);
        return;
      }
      if (showNoUpdateToast) {
        showToast(t("app.name"), t("toasts.upToDate", { version: status.current }), null);
      }
    })
    .catch((error) => {
      console.info("[AxoTube:updater] update check skipped:", error && error.message);
      if (showNoUpdateToast) {
        showToast(t("app.name"), t("toasts.updateCheckFailed"), null);
      }
    });
}

// Applies the newest bundle and reloads. The reload picks up the new bundles,
// so the running page never mixes old and new code.
function applyUpdate() {
  showToast(t("app.name"), t("updater.applying"), null);
  fetch(proxyUrl("/axotube/update/apply"), { method: "POST" })
    .then((response) => {
      if (!response.ok) throw new Error("apply HTTP " + response.status);
      return response.json();
    })
    .then((status) => {
      if (status.error) throw new Error(status.error);
      window.location.reload();
    })
    .catch((error) => {
      console.error("[AxoTube:updater] apply failed:", error && error.message);
      showToast(t("app.name"), t("toasts.updateApplyFailed"), null);
    });
}

// Automatic check shortly after load, unless the user chose "remind later".
try {
  if (configRead("enableUpdater") && configRead("dontCheckUpdateUntil") <= Math.floor(Date.now() / 1000)) {
    setTimeout(() => checkForUpdates(false), BOOT_CHECK_DELAY_MS);
  }
} catch (err) {
  console.error("[AxoTube:updater] init failed, continuing without it", err);
}

export { applyUpdate };
export default checkForUpdates;
