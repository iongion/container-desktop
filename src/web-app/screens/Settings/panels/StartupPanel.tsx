import { Checkbox, ControlGroup, FormGroup } from "@blueprintjs/core";
import { type ChangeEvent, useCallback } from "react";
import { useTranslation } from "react-i18next";

import { useAppStore } from "@/web-app/stores/appStore";

// Startup & behavior: tray minimize, automatic update check at startup, and dropped-connection reconnect.
export const StartupPanel: React.FC = () => {
  const { t } = useTranslation();
  const userSettings = useAppStore((state) => state.userSettings);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);

  const onMinimizeToSystemTray = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      await setGlobalUserSettings({
        minimizeToSystemTray: !!e.currentTarget.checked,
      });
    },
    [setGlobalUserSettings],
  );
  const onCheckLatestVersion = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      await setGlobalUserSettings({
        checkLatestVersion: !!e.currentTarget.checked,
      });
    },
    [setGlobalUserSettings],
  );
  const onAutoReconnect = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      await setGlobalUserSettings({
        reconnect: { ...userSettings.reconnect, enabled: !!e.currentTarget.checked },
      });
    },
    [setGlobalUserSettings, userSettings.reconnect],
  );

  return (
    <div className="AppSettingsForm" data-form="flags">
      <FormGroup className="AppSettingsFeaturesToggles">
        <ControlGroup>
          <Checkbox
            id="minimizeToSystemTray"
            label={t("Minimize to System Tray when closing")}
            checked={!!userSettings.minimizeToSystemTray}
            onChange={onMinimizeToSystemTray}
          />
        </ControlGroup>
        <ControlGroup>
          <Checkbox
            id="checkLatestVersion"
            label={t("Automatically check for new version at startup")}
            checked={!!userSettings.checkLatestVersion}
            onChange={onCheckLatestVersion}
          />
        </ControlGroup>
        <ControlGroup>
          <Checkbox
            id="autoReconnect"
            label={t("Automatically reconnect dropped connections")}
            checked={userSettings.reconnect?.enabled ?? true}
            onChange={onAutoReconnect}
          />
        </ControlGroup>
      </FormGroup>
    </div>
  );
};
