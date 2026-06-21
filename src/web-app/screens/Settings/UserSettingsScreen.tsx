import { IconNames } from "@blueprintjs/icons";

import type { AppScreen, AppScreenProps } from "@/web-app/Types";

import { SettingsLayout } from "./SettingsLayout";
import "./UserSettingsScreen.css";

// Thin screen shell: owns the screen identity/route/metadata and delegates the whole body to
// SettingsLayout (category rail + panels). The per-category forms live in ./panels and ./AISettingsForm.

interface ScreenProps extends AppScreenProps {}

export const ID = "settings-settings";
export const View = "user-settings";
export const Title = "Settings";

export const Screen: AppScreen<ScreenProps> = () => {
  return (
    <div className="AppScreen" data-screen={ID}>
      <SettingsLayout />
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/settings/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true,
};
