import { useCallback, useState } from "react";
import { AnchorButton, Button, Callout, Checkbox, ControlGroup, FormGroup, HTMLSelect, Icon, InputGroup, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import * as ReactIcon from "@mdi/react";
import { mdiEmoticonSad, mdiEmoticonWink } from "@mdi/js";

// project
import Environment, { LOGGING_LEVELS } from "../../Environment";
import { AppScreen, AppScreenProps, UserConfigurationOptions } from "../../Types";
import { ScreenHeader } from "./ScreenHeader";
import { Native } from "../../Native";
import { Notification } from "../../Notification";
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
  const [programPaths, setProgramPaths] = useState<{ [key: string]: any }>({});
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const native = useStoreState((state) => state.native);
  const running = useStoreState((state) => state.environment.running);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const connect = useStoreActions((actions) => actions.connect);
  const setUserConfiguration = useStoreActions((actions) => actions.setUserConfiguration);
  const program = userConfiguration.program;
  const provisioned = !!program.path;
  const isValid = provisioned && program.currentVersion;
  const onProgramSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const sender = e.currentTarget as HTMLElement;
      const field = sender?.closest(".AppSettingsField");
      const program = field?.getAttribute("data-program-name");
      const result = await Native.getInstance().openFileSelector();
      if (result) {
        const filePath = result?.filePaths[0];
        if (!result.canceled && filePath && program) {
          try {
            await setUserConfiguration({
              program: { name: "podman", path: filePath }
            });
            setProgramPaths((prev) => ({ ...prev, [program]: filePath }));
          } catch (error) {
            console.error("Unable to change program path", error);
            Notification.show({ message: t("Unable to change program path"), intent: Intent.DANGER });
          }
        }
      } else {
        console.error("Unable to open file dialog");
      }
    },
    [setUserConfiguration, setProgramPaths, t]
  );
  const onProgramPathChange = useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      const sender = event.currentTarget;
      const field = sender?.closest(".AppSettingsField");
      const program = field?.getAttribute("data-program-name");
      if (program) {
        setProgramPaths({ ...programPaths, [program]: sender.value });
      }
    },
    [programPaths]
  );
  const onConnectClick = useCallback(
    async () => {
      await connect({ startApi: true });
    },
    [connect]
  );
  const onAutoStartApiChange = useCallback(async (e) => {
    await setUserConfiguration({ autoStartApi: !!e.currentTarget.checked });
  }, [setUserConfiguration]);
  const onCLICommunicationChange = useCallback(async (e) => {
    const nextCommunication = !!e.currentTarget.checked ? "cli" : "api";
    await setUserConfiguration({ communication: nextCommunication });
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
  let reconnectActionText = t("Connect");
  if (program?.path) {
    title = t("The API is not running");
    errorMessage = t("Check the logs from application data path if this is not intended behavior");
    icon = mdiEmoticonWink;
    reconnectActionText = t("Connect and try to start the api");
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
        <Button disabled={pending} fill text={reconnectActionText} icon={IconNames.REFRESH} onClick={onConnectClick} />
      </Callout>
    );
  const engineSwitcher = Environment.features.engineSwitcher?.enabled ? <ContainerEngineManager /> : null;

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} />
      <div className="AppScreenContent">
        {contentWidget}
        <div className="AppSettingsForm" data-form="paths">
          <div
            className="AppSettingsField"
            data-field="program.path"
            data-program-name={program?.name}
            data-program-present={isValid ? "yes" : "no"}
          >
            <div className="AppSettingUserConfigurationPath">
              <Icon icon={IconNames.INFO_SIGN} />
              <strong>{t('Application settings and logs path')}</strong>
              <input type="text" value={userConfiguration.path} readOnly/>
            </div>
            <FormGroup
              helperText={
                <div className="AppSettingsFieldProgramHelper">
                  &nbsp;
                  {isValid ? (
                    <span>{t("Detected version {{currentVersion}}", program)}</span>
                  ) : program?.currentVersion ? (
                    t("The location of the {{program}} executable binary", { program: program?.name })
                  ) : (
                    t("Could not detect current version")
                  )}
                </div>
              }
              label={
                <AnchorButton
                  minimal
                  icon={isValid ? IconNames.THUMBS_UP : IconNames.THUMBS_DOWN}
                  intent={isValid ? Intent.SUCCESS : Intent.DANGER}
                  text={program.name}
                  title={t("Go to {{name}} homepage", program)}
                  target="_blank"
                  href={program.homepage || ""}
                />
              }
              labelFor={`${program.name}_path`}
              labelInfo={t("(required)")}
            >
              <ControlGroup fill={true} vertical={false}>
                <InputGroup
                  fill
                  id={`${program.name}_path`}
                  readOnly={native}
                  placeholder={"..."}
                  value={programPaths[program.name || ""] || program.path}
                  onChange={onProgramPathChange}
                />
                {native ? (
                  <Button
                    icon={IconNames.LOCATE}
                    text={t("Select")}
                    title={t("Select program")}
                    intent={Intent.PRIMARY}
                    onClick={onProgramSelectClick}
                  />
                ) : (
                  <Button icon={IconNames.TICK} title={t("Accept")} />
                )}
              </ControlGroup>
            </FormGroup>
          </div>
        </div>
        {engineSwitcher}
        <div className="AppSettingsForm" data-form="flags">
          <FormGroup
            label={t("Startup")}
            labelFor="autoStartApi"
            helperText={t('Not needed if container engine is already running as a service')}
          >
            <ControlGroup fill={true}>
              <Checkbox
                id="autoStartApi"
                disabled={pending}
                label={t("Automatically start the Api")}
                checked={!!userConfiguration.autoStartApi}
                onChange={onAutoStartApiChange}
              />
            </ControlGroup>
          </FormGroup>
          <FormGroup
            label={t("Communication")}
            labelFor="connectionType"
            helperText={t('It will spawn the CLI tool each time')}
          >
            <ControlGroup fill={true}>
              <Checkbox
                id="connectionType"
                disabled={pending}
                label={t("Use command line instead of the api")}
                checked={userConfiguration.communication === "cli"}
                onChange={onCLICommunicationChange}
              />
            </ControlGroup>
          </FormGroup>
        </div>
        <div className="AppSettingsForm" data-form="logging">
          <FormGroup
            label={t("Logging level")}
            labelFor="loggingLevel"
          >
            <ControlGroup>
              <HTMLSelect id="loggingLevel" disabled={pending} value={userConfiguration.logging.level} onChange={onLoggingLevelChange}>
                {LOGGING_LEVELS.map((level) => {
                  const key= `logging.${level}`;
                  return <option key={key} value={level}>{level}</option>;
                })}
              </HTMLSelect>
              <Button icon={IconNames.SEARCH} text={t('Toggle inspector')} onClick={onToggleInspectorClick} />
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
