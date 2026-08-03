import { pathTo } from "@/web-app/Navigator";
import { Path } from "./UserSettingsScreen";

export const getSettingsUrl = (category?: string) => pathTo(Path, undefined, { category });

export const goToSettings = (category?: string) => {
  window.location.href = getSettingsUrl(category);
};
