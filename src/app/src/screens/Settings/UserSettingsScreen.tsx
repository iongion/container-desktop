import { useCallback } from "react";
import { Icon, Button, Callout, Checkbox, ControlGroup, FormGroup, HTMLSelect } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiEmoticonSad, mdiEmoticonWink } from "@mdi/js";

// project
import { LOGGING_LEVELS } from "../../Environment";
import { AppScreen, AppScreenProps, UserConfigurationOptions } from "../../Types";
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
  const pending = useStoreState((state) => state.pending);
  const provisioned = useStoreState((state) => state.environment.provisioned);
  const system = useStoreState((state) => state.environment.system);
  const running = useStoreState((state) => state.environment.running);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const setUserConfiguration = useStoreActions((actions) => actions.setUserConfiguration);
  const program = userConfiguration.program;
  const onAutoStartApiChange = useCallback(async (e) => {
    await setUserConfiguration({ startApi: !!e.currentTarget.checked });
  }, [setUserConfiguration]);
  const onMinimizeToSystemTray = useCallback(async (e) => {
    await setUserConfiguration({ minimizeToSystemTray: !!e.currentTarget.checked });
  }, [setUserConfiguration]);
  const onLoggingLevelChange = useCallback(async (e) => {
    const configuration: Partial<UserConfigurationOptions> = {};
    configuration["logging.level"] = e.currentTarget.value;
    await setUserConfiguration(configuration);
  }, [setUserConfiguration]);
  const onToggleInspectorClick = useCallback(async (e) => {
    Native.getInstance().openDevTools();
  }, []);

  let title = "";
  let errorMessage = "";
  let icon = mdiEmoticonSad;
  if (program?.path) {
    title = t("The API is not running");
    errorMessage = t("Check the logs from application data path if this is not intended behavior");
    icon = mdiEmoticonWink;
  } else {
    title = t("Automatic detection failed");
    errorMessage = t("To be able to continue, all required programs need to be installed");
  }

  const contentWidget =
    provisioned && running ? null : (
      <Callout
        className="AppSettingsCallout"
        title={title}
        icon={<ReactIcon.Icon path={icon} size={3} />}
      >
        <p>{errorMessage}</p>
      </Callout>
    );

  let runningDetails: any = "";
  if (system) {
    runningDetails = t(
      "Running on {{distribution}} {{distributionVersion}} ({{kernel}})",
      {
        currentVersion: program.currentVersion,
        hostname: system.host?.hostname || "",
        distribution: system.host?.distribution?.distribution || "",
        distributionVersion: system.host?.distribution?.version || "",
        kernel: system.host?.kernel || ""
      }
    );
  } else {
    if (program.path) {
      runningDetails = t("Unable to detect system - try to connect and start the api");
      if (program.name === "podman" && userConfiguration.engine === "virtualized" && !running) {
        runningDetails = (
          <>
            <span>{t("Unable to detect system - podman machine may need restart")}</span> &mdash;
            <code className="DocsCodeBox">podman machine stop &amp;&amp; podman machine start</code>
          </>
        );
      }
    } else {
      runningDetails = t("Unable to detect system - no {{name}} program found, install first then restart and come back", program);
    }
  }

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} />
      <div className="AppScreenContent">
        {contentWidget}
        <ContainerEngineManager helperText={runningDetails} />
        <div className="AppSettingsForm" data-form="flags">
          <FormGroup
            label={t("Startup")}
            labelFor="startApi"
            helperText={t("Not needed if container engine is already running as a service")}
          >
            <ControlGroup fill={true}>
              <Checkbox
                id="startApi"
                disabled={pending}
                label={t("Automatically start the Api")}
                checked={!!userConfiguration.startApi}
                onChange={onAutoStartApiChange}
              />
            </ControlGroup>
          </FormGroup>
          <FormGroup>
            <ControlGroup fill={true}>
              <Checkbox
                id="minimizeToSystemTray"
                disabled={pending}
                label={t("Minimize to System Tray when closing")}
                checked={!!userConfiguration.minimizeToSystemTray}
                onChange={onMinimizeToSystemTray}
              />
            </ControlGroup>
          </FormGroup>
        </div>
        <div className="AppSettingsForm" data-form="logging">
          <FormGroup
            label={t("Logging and debugging")}
            labelFor="loggingLevel"
          >
          <div className="AppSettingUserConfigurationPath">
            <Icon icon={IconNames.INFO_SIGN} />
            <strong>{t('Application settings and logs path')}</strong>
            <input type="text" value={userConfiguration.path} readOnly/>
          </div>
            <ControlGroup >
              <HTMLSelect id="loggingLevel" disabled={pending} value={userConfiguration.logging.level} onChange={onLoggingLevelChange}>
                {LOGGING_LEVELS.map((level) => {
                  const key= `logging.${level}`;
                  return <option key={key} value={level}>{level}</option>;
                })}
              </HTMLSelect>
              <Button disabled={pending} icon={IconNames.PANEL_TABLE} text={t('Show inspector')} onClick={onToggleInspectorClick} />
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
