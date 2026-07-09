import { type IconName, IconNames } from "@blueprintjs/icons";

import i18n from "@/i18n";

// Pure, framework-free model for the Settings screen's category rail. Holds only display metadata
// (id + i18n title + icon) and the default selection — the React panel map lives in
// settingsCategories.tsx. Kept dependency-light so it is unit-tested under plain Node (no RTL).

export interface SettingsCategory {
  id: string;
  // i18n key — translated with t() at render time.
  title: string;
  icon: IconName;
}

// Listed alphabetically by (English) title — the order the rail renders. AI Assistant stays first, so the
// default category / deep-link fallback is unchanged.
export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "ai", title: i18n.t("AI Assistant"), icon: IconNames.PREDICTIVE_ANALYSIS },
  { id: "policy", title: i18n.t("Air-gap & policy"), icon: IconNames.SHIELD },
  { id: "appearance", title: i18n.t("Appearance"), icon: IconNames.STYLE },
  { id: "config", title: i18n.t("Configuration"), icon: IconNames.COG },
  { id: "logging", title: i18n.t("Logging"), icon: IconNames.CONSOLE },
  { id: "network", title: i18n.t("Network"), icon: IconNames.GLOBE_NETWORK },
  { id: "startup", title: i18n.t("Startup & behavior"), icon: IconNames.POWER },
];

export const DEFAULT_SETTINGS_CATEGORY_ID: string = SETTINGS_CATEGORIES[0].id;

export function resolveSettingsCategoryId(category?: string): string {
  return SETTINGS_CATEGORIES.some((c) => c.id === category) ? category! : DEFAULT_SETTINGS_CATEGORY_ID;
}
