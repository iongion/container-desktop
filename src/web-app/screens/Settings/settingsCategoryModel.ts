import { type IconName, IconNames } from "@blueprintjs/icons";

// Pure, framework-free model for the Settings screen's category rail. Holds only display metadata
// (id + i18n title + icon) and the default selection — the React panel map lives in
// settingsCategories.tsx. Kept dependency-light so it is unit-tested under plain Node (no RTL).

export interface SettingsCategory {
  id: string;
  /** i18n key — translated with t() at render time. */
  title: string;
  icon: IconName;
}

export const SETTINGS_CATEGORIES: SettingsCategory[] = [
  { id: "ai", title: "AI Assistant", icon: IconNames.PREDICTIVE_ANALYSIS },
  { id: "appearance", title: "Appearance", icon: IconNames.STYLE },
  { id: "config", title: "Configuration", icon: IconNames.COG },
  { id: "logging", title: "Logging", icon: IconNames.CONSOLE },
  { id: "network", title: "Network", icon: IconNames.GLOBE_NETWORK },
  { id: "startup", title: "Startup & behavior", icon: IconNames.POWER },
];

export const DEFAULT_SETTINGS_CATEGORY_ID: string = SETTINGS_CATEGORIES[0].id;

export function resolveSettingsCategoryId(category?: string): string {
  return SETTINGS_CATEGORIES.some((c) => c.id === category) ? category! : DEFAULT_SETTINGS_CATEGORY_ID;
}
