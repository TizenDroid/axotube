import { SettingActionRenderer, SettingsCategory } from "./ytUI.js";
import { t } from "i18next";

function PatchSettings(settingsObject) {
  const axotubeOpenAction = SettingActionRenderer(
    t("settings.ttSettings.title"),
    "axotube_open_action",
    {
      customAction: {
        action: "AXO_SETTINGS_SHOW",
        parameters: [],
      },
    },
    t("settings.ttSettings.summary"),
    "https://www.gstatic.com/ytlr/img/parent_code.png",
  );

  const axotubeCategory = SettingsCategory("axotube_category", [axotubeOpenAction]);
  if (!settingsObject.items || !Array.isArray(settingsObject.items)) settingsObject.items = [];
  // Add it as the first item in the settings object
  settingsObject.items.unshift(axotubeCategory);
}

export { PatchSettings };
