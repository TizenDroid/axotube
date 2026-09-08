// axotube Cobalt Update Checker
import {
  buttonItem,
  showModal,
  showToast,
  overlayPanelItemListRenderer,
} from "../ui/ytUI.js";
import { configRead } from "../config.js";
import { fetchWithTimeout } from "../shared/fetch.js";

try {
  if (window.h5vcc && window.h5vcc.tizentube && configRead("enableUpdater")) {
    const currentEpoch = Math.floor(Date.now() / 1000);
    if (configRead("dontCheckUpdateUntil") <= currentEpoch) checkForUpdates();
  }
} catch (err) {
  console.error("axotube updater: init failed, continuing without it", err);
}

function normalizeVersion(version) {
  return String(version || "")
    .trim()
    .replace(/^v/i, "")
    .split("+")[0];
}

function compareVersions(a, b) {
  const leftVersion = normalizeVersion(a);
  const rightVersion = normalizeVersion(b);
  const leftDash = leftVersion.indexOf("-");
  const rightDash = rightVersion.indexOf("-");
  const leftCore = (leftDash === -1 ? leftVersion : leftVersion.slice(0, leftDash)).split(".");
  const rightCore = (rightDash === -1 ? rightVersion : rightVersion.slice(0, rightDash)).split(".");
  const count = Math.max(leftCore.length, rightCore.length);

  for (let i = 0; i < count; i += 1) {
    const av = Number.parseInt(leftCore[i] || "0", 10);
    const bv = Number.parseInt(rightCore[i] || "0", 10);
    const safeA = Number.isFinite(av) ? av : 0;
    const safeB = Number.isFinite(bv) ? bv : 0;
    if (safeA > safeB) return 1;
    if (safeA < safeB) return -1;
  }

  const leftPre = leftDash === -1 ? null : leftVersion.slice(leftDash + 1).split(".");
  const rightPre = rightDash === -1 ? null : rightVersion.slice(rightDash + 1).split(".");
  if (!leftPre && rightPre) return 1;
  if (leftPre && !rightPre) return -1;
  if (!leftPre && !rightPre) return 0;

  const preCount = Math.max(leftPre.length, rightPre.length);
  for (let i = 0; i < preCount; i += 1) {
    const leftId = leftPre[i];
    const rightId = rightPre[i];
    if (leftId === undefined) return -1;
    if (rightId === undefined) return 1;
    if (leftId === rightId) continue;

    const leftNumeric = /^\d+$/.test(leftId);
    const rightNumeric = /^\d+$/.test(rightId);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftId);
      const rightNumber = Number(rightId);
      if (leftNumber > rightNumber) return 1;
      if (leftNumber < rightNumber) return -1;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftId > rightId ? 1 : -1;
  }
  return 0;
}

function getLatestRelease() {
  return fetchWithTimeout(
    "https://api.github.com/repos/reisxd/TizenTubeCobalt/releases/latest",
    { headers: { Accept: "application/vnd.github+json" } },
  ).then((response) => {
    if (!response.ok) throw new Error(`Update API HTTP ${response.status}`);
    return response.json();
  });
}

function findDownloadUrl(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  if (!assets.length) return null;

  let architecture = "";
  try {
    if (typeof window.h5vcc.tizentube.GetArchitecture === "function") {
      architecture = String(window.h5vcc.tizentube.GetArchitecture() || "").toLowerCase();
    }
  } catch (err) {}

  let asset = null;
  if (architecture.includes("arm64") || architecture.includes("aarch64")) {
    asset = assets.find((item) => /arm64[^/]*\.apk$/i.test(item?.name || ""));
    return asset ? asset.browser_download_url : null;
  }
  if (architecture.includes("arm")) {
    asset = assets.find(
      (item) => /arm[^/]*\.apk$/i.test(item?.name || "") && !/arm64/i.test(item?.name || ""),
    );
    return asset ? asset.browser_download_url : null;
  }

  // Only use a generic APK fallback when the runtime cannot report a known
  // architecture. Never install a different architecture just because it is
  // the first APK in a release.
  asset = assets.find((item) => /\.apk$/i.test(item?.name || ""));
  return asset ? asset.browser_download_url : null;
}

function checkForUpdates(showNoUpdateToast) {
  if (
    !window.h5vcc ||
    !window.h5vcc.tizentube ||
    typeof window.h5vcc.tizentube.GetVersion !== "function"
  ) return;

  const currentAppVersion = normalizeVersion(window.h5vcc.tizentube.GetVersion());
  const currentEpoch = Math.floor(Date.now() / 1000);

  getLatestRelease()
    .then((release) => {
      const latestVersion = normalizeVersion(release?.tag_name);
      if (!latestVersion) throw new Error("Release is missing a version tag");

      if (compareVersions(latestVersion, currentAppVersion) <= 0) {
        console.info("You are using the latest version of axotube Cobalt.");
        if (showNoUpdateToast) {
          showToast(
            "axotube is up to date",
            `You are using version ${currentAppVersion} of axotube Cobalt.`,
            null,
          );
        }
        return;
      }

      const downloadUrl = findDownloadUrl(release);
      if (!downloadUrl) {
        showToast(
          "axotube update available",
          `Version ${latestVersion} is available, but no compatible APK was found in the release.`,
          null,
        );
        return;
      }

      const releaseDate = release?.published_at
        ? new Date(release.published_at).toLocaleString()
        : "Unknown";
      const releaseNotes = typeof release?.body === "string" ? release.body : "";

      showModal(
        {
          title: "Update Available",
          subtitle: `A new version of axotube Cobalt is available: ${latestVersion}\nCurrent version: ${currentAppVersion}\nRelease Date: ${releaseDate}\nRelease Notes:\n${releaseNotes}`,
        },
        overlayPanelItemListRenderer([
          buttonItem(
            {
              title: "Update Now",
              subtitle: "Click to download the latest version.",
            },
            { icon: "DOWN_ARROW" },
            [
              { customAction: { action: "UPDATE_DOWNLOAD", parameters: downloadUrl } },
              { signalAction: { signal: "POPUP_BACK" } },
            ],
          ),
          buttonItem(
            {
              title: "Remind Me Later",
              subtitle: "Check for updates later.",
            },
            { icon: "SEARCH_HISTORY" },
            [
              {
                customAction: {
                  action: "UPDATE_REMIND_LATER",
                  parameters: currentEpoch + 86400,
                },
              },
              { signalAction: { signal: "POPUP_BACK" } },
            ],
          ),
        ]),
        "tt-update-modal",
        false,
      );
    })
    .catch((error) => {
      console.error("Error fetching the latest release:", error);
      if (showNoUpdateToast) {
        showToast("axotube update check failed", "Could not check for updates.", null);
      }
    });
}

export { compareVersions, findDownloadUrl };
export default checkForUpdates;
