// Cast presence on the TV side. Asks the on-device service to re-announce the
// TV on the local network: when the app comes back to the front, and from the
// "Restart cast receiver" settings button. The service rate-limits restarts and
// also watches for standby on its own, so the app only needs to ask.
import { fetchWithTimeout } from "../shared/fetch.js";
import { t } from "i18next";
import { showToast } from "../ui/ytUI.js";

const SERVICE_URL = "http://127.0.0.1:8085";

export function requestCastRestart(reason, onDone) {
  fetchWithTimeout(`${SERVICE_URL}/api/cast/restart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((body) => {
      if (onDone) onDone(null, body);
    })
    .catch((err) => {
      if (onDone) onDone(err, null);
    });
}

// Settings button: says what happened, so a user who presses it twice in a row
// is told it was already restarting, not left guessing.
export function restartCastReceiver() {
  requestCastRestart("manual", (err, body) => {
    if (err || !body || !body.ok) {
      showToast(t("app.name"), t("toasts.castRestartFailed"));
      return;
    }
    if (body.restarted) showToast(t("app.name"), t("toasts.castRestarted"));
    else if (body.reason === "too-soon") showToast(t("app.name"), t("toasts.castRestartWait"));
    else showToast(t("app.name"), t("toasts.castRestarting"));
  });
}

// Front-of-screen refresh. Only the transition to visible matters; hidden is
// left to the service's own standby detection.
document.addEventListener("visibilitychange", function () {
  if (document.hidden) return;
  requestCastRestart("focus");
});
