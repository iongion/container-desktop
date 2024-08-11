import { useCallback } from "react";
import { Icon, Button, Callout, Checkbox, ControlGroup, FormGroup, HTMLSelect } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiEmoticonSad, mdiEmoticonWink } from "@mdi/js";

// project
import { GlobalUserSettingsOptions } from "../../Types.container-app";

import { CURRENT_ENVIRONMENT, LOGGING_LEVELS, PROJECT_VERSION } from "../../Environment";
import { AppScreen, AppScreenProps } from "../../Types";
import { ScreenHeader } from "./ScreenHeader";
import { Native } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";

// module
import { ContainerEngineManager } from "./EngineManager";

import "./UserSettingsScreen.css";

// Screen

interface ScreenProps extends AppScreenProps {}

export const ID = "settings.user-settings";
export const View = "user-settings";
export const Title = "Settings";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
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
    Native.getInstance().openDevTools();
  }, []);

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
        <div className="AppScreenHeaderText">{`${PROJECT_VERSION}.${CURRENT_ENVIRONMENT[0]}`}</div>
      </ScreenHeader>
      <div className="AppScreenContent">
        {contentWidget}
        <ContainerEngineManager />
        <div className="AppSettingsForm" data-form="flags">
          <FormGroup
            label={t("Startup")}
            labelFor="startApi"
            helperText={t("Not needed if container engine is already running as a service")}
          >
            <ControlGroup fill={true}>
              <Checkbox
                id="startApi"
                label={t("Automatically start the Api")}
                checked={!!userSettings.startApi}
                onChange={onAutoStartApiChange}
              />
            </ControlGroup>
          </FormGroup>
          <FormGroup>
            <ControlGroup fill={true}>
              <Checkbox
                id="minimizeToSystemTray"
                label={t("Minimize to System Tray when closing")}
                checked={!!userSettings.minimizeToSystemTray}
                onChange={onMinimizeToSystemTray}
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
              <HTMLSelect id="loggingLevel" value={userSettings.logging.level} onChange={onLoggingLevelChange}>
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
              <Button icon={IconNames.PANEL_TABLE} text={t("Show inspector")} onClick={onToggleInspectorClick} />
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
