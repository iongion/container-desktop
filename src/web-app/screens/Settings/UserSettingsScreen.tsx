import {
  AnchorButton,
  Button,
  ButtonGroup,
  Callout,
  Checkbox,
  ControlGroup,
  FormGroup,
  HTMLSelect,
  Icon,
  Intent
} from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiEmoticonSad, mdiEmoticonWink } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

// project
import { GlobalUserSettingsOptions } from "../../Types.container-app";

import { LOGGING_LEVELS, PROJECT_VERSION } from "../../Environment";
import { Native } from "../../Native";
import { AppScreen, AppScreenProps } from "../../Types";
import { useStoreActions, useStoreState } from "../../domain/types";
import { ScreenHeader } from "./ScreenHeader";

// module
import { ContainerEngineManager } from "./EngineManager";

import { Notification } from "@/web-app/Notification";
import { registry } from "@/web-app/domain/registry";
import "./UserSettingsScreen.css";

// Screen

interface ScreenProps extends AppScreenProps {}

export const ID = "settings.user-settings";
export const View = "user-settings";
export const Title = "Settings";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [isChecking, setIsChecking] = useState(false);
  const provisioned = useStoreState((state) => state.descriptor.provisioned);
  const running = useStoreState((state) => state.descriptor.running);
  const currentConnector = useStoreState((state) => state.descriptor.currentConnector);
  const userSettings = useStoreState((state) => state.descriptor.userSettings);
  const setGlobalUserSettings = useStoreActions((actions) => actions.setGlobalUserSettings);
  const program = currentConnector.settings.current.program;

  const onAutoStartApiChange = useCallback(
    async (e) => {
      await setGlobalUserSettings({ startApi: !!e.currentTarget.checked });
    },
    [setGlobalUserSettings]
  );
  const onMinimizeToSystemTray = useCallback(
    async (e) => {
      await setGlobalUserSettings({ minimizeToSystemTray: !!e.currentTarget.checked });
    },
    [setGlobalUserSettings]
  );
  const onCheckLatestVersion = useCallback(
    async (e) => {
      await setGlobalUserSettings({ checkLatestVersion: !!e.currentTarget.checked });
    },
    [setGlobalUserSettings]
  );
  const onLoggingLevelChange = useCallback(
    async (e) => {
      const configuration: Partial<GlobalUserSettingsOptions> = {};
      configuration.logging = {
        level: e.currentTarget.value
      };
      await setGlobalUserSettings(configuration);
    },
    [setGlobalUserSettings]
  );
  const onToggleInspectorClick = useCallback(async (e) => {
    const instance = await Native.getInstance();
    await instance.openDevTools();
  }, []);
  const onVersionCheck = useCallback(async () => {
    setIsChecking(true);
    try {
      const check = await registry.onlineApi.checkLatestVersion();
      console.debug("Checking for new version", check);
      if (!check.hasUpdate) {
        Notification.show({
          message: t("A newer version {{latest}} has been found", check),
          intent: Intent.PRIMARY
        });
      } else {
        Notification.show({ message: t("No new version detected"), intent: Intent.SUCCESS });
      }
    } catch (error: any) {
      Notification.show({ message: t("Unable to check latest version"), intent: Intent.DANGER });
    }
    setIsChecking(false);
  }, [t]);

  let title = "";
  let errorMessage = "";
  let icon = mdiEmoticonSad;
  if (program?.path) {
    title = t("Unusable connection");
    errorMessage = t("Check the logs from application data path if this is not intended behavior");
    icon = mdiEmoticonWink;
  } else {
    title = t("Automatic detection failed");
    errorMessage = t("To be able to continue, all required programs need to be installed");
  }

  const contentWidget =
    provisioned && running ? null : (
      <Callout className="AppSettingsCallout" title={title} icon={<ReactIcon.Icon path={icon} size={3} />}>
        <p>{errorMessage}</p>
      </Callout>
    );

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID}>
        <div className="AppScreenHeaderText">{PROJECT_VERSION}</div>
      </ScreenHeader>
      <div className="AppScreenContent">
        {contentWidget}
        <ContainerEngineManager />
        <div className="AppSettingsForm" data-form="flags">
          <FormGroup labelFor="startApi" helperText={t("If container engine is not running as a service")}>
            <ControlGroup>
              <Checkbox
                id="startApi"
                label={t("Automatically start the Api")}
                checked={!!userSettings.startApi}
                onChange={onAutoStartApiChange}
              />
            </ControlGroup>
          </FormGroup>
          <FormGroup labelFor="minimizeToSystemTray">
            <ControlGroup>
              <Checkbox
                id="minimizeToSystemTray"
                label={t("Minimize to System Tray when closing")}
                checked={!!userSettings.minimizeToSystemTray}
                onChange={onMinimizeToSystemTray}
              />
            </ControlGroup>
          </FormGroup>
          <FormGroup
            labelFor="checkLatestVersion"
            helperText={
              <ButtonGroup fill>
                <Button
                  loading={isChecking}
                  disabled={isChecking}
                  intent={Intent.PRIMARY}
                  small
                  text={t("Check now")}
                  icon={IconNames.UPDATED}
                  onClick={onVersionCheck}
                />
                <AnchorButton
                  icon={IconNames.DOWNLOAD}
                  text={t("Versions")}
                  href="https://github.com/iongion/podman-desktop-companion/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                />
              </ButtonGroup>
            }
          >
            <ControlGroup>
              <Checkbox
                id="checkLatestVersion"
                label={t("Automatically check for new version at startup")}
                checked={!!userSettings.checkLatestVersion}
                onChange={onCheckLatestVersion}
              />
            </ControlGroup>
          </FormGroup>
        </div>
        <div className="AppSettingsForm" data-form="logging">
          <FormGroup label={t("Configuration and logging")} labelFor="userSettingsPath">
            <div className="AppSettingUserConfigurationPath">
              <Icon icon={IconNames.INFO_SIGN} />
              <strong>{t("Storage path")}</strong>
              <input id="userSettingsPath" name="userSettingsPath" type="text" value={userSettings.path} readOnly />
            </div>
          </FormGroup>
          <FormGroup label={t("Level")} labelFor="loggingLevel">
            <ControlGroup>
              <HTMLSelect
                id="loggingLevel"
                value={userSettings.logging.level ?? "error"}
                onChange={onLoggingLevelChange}
              >
                {LOGGING_LEVELS.map((level) => {
                  const key = `logging.${level}`;
                  return (
                    <option key={key} value={level}>
                      {level}
                    </option>
                  );
                })}
              </HTMLSelect>
            </ControlGroup>
          </FormGroup>

          <FormGroup label={t("Debugging")} labelFor="loggingLevel">
            <ControlGroup>
              <Button icon={IconNames.PANEL_TABLE} text={t("Toggle inspector")} onClick={onToggleInspectorClick} />
            </ControlGroup>
          </FormGroup>
        </div>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/settings/${View}`
};
Screen.Metadata = {
  LeftIcon: IconNames.COG,
  ExcludeFromSidebar: true
};
