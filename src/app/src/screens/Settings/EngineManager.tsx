import { useCallback, useState, useMemo } from "react";
import { Button, ControlGroup, InputGroup, Intent, RadioGroup, Radio, FormGroup, Label } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

// project
import { ContainerEngine, TestResult } from "../../Types";
import { Native, Platforms } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";
import { RadioLabel } from "../../components/RadioLabel";
import { RestrictedTo } from "../../components/RestrictedTo";
import { Notification } from "../../Notification";

interface ContainerEngineSettingsProps {
  engine: ContainerEngine;
  disabled?: boolean;
}

export const ContainerEngineSettingsProgramLocal: React.FC<ContainerEngineSettingsProps> = ({ engine, disabled }) => {
  const { t } = useTranslation();
  const provisioned = useStoreState((state) => state.environment.provisioned);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const setUserConfiguration = useStoreActions((actions) => actions.setUserConfiguration);
  const testSocketPathConnection = useStoreActions((actions) => actions.testSocketPathConnection);
  const program = userConfiguration.program;
  const isValid = provisioned && program.currentVersion;
  const [socketPath, setSocketPath] = useState(userConfiguration.socketPath);
  const onSocketPathChange = useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      const sender = event.currentTarget;
      setSocketPath(sender.value);
    },
    [setSocketPath]
  );
  const onSocketPathTestClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const result: TestResult = await testSocketPathConnection(socketPath);
    console.debug(result);
    if (result.success) {
      Notification.show({ message: t("API was reached successfully"), intent: Intent.SUCCESS });
    } else {
      Notification.show({ message: t("API could not be reached"), intent: Intent.DANGER });
    }
    console.debug("Test result is", result);
  }, [socketPath, testSocketPathConnection, t]);
  const onProgramSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const result = await Native.getInstance().openFileSelector();
      if (result) {
        const filePath = result?.filePaths[0];
        if (!result.canceled && filePath) {
          try {
            const program = filePath.split(/\\|\//).pop()?.replace(".exe", "") || "";
            const programSettings: any = {};
            const programKey = `program.${program}.path`;
            programSettings[programKey] = filePath;
            await setUserConfiguration(programSettings);
          } catch (error) {
            console.error("Unable to change program path", error);
            Notification.show({ message: t("Unable to change program path"), intent: Intent.DANGER });
          }
        }
      } else {
        console.error("Unable to open file dialog");
      }
    },
    [setUserConfiguration, t]
  );
  const isSocketPathChanged = socketPath !== userConfiguration.socketPath;
  const isLIMA = engine === ContainerEngine.SUBSYSTEM_LIMA;
  const suffix = isLIMA ? <span> - {t("Automatically detected inside LIMA VM")}</span> : "";
  return (
    <div className="ContainerEngineSettings" data-settings="program.local">
      <FormGroup
        helperText={
          <div className="AppSettingsFieldProgramHelper">
            &nbsp;
            {isValid ? (
              <>
                <span>{t("Detected version {{currentVersion}}", program)}</span>
                {suffix}
              </>
            ) : program?.currentVersion ? (
              t("The location of the {{program}} executable binary", { program: program?.name })
            ) : (
              t("Could not detect current version")
            )}
          </div>
        }
        label={t("Path to {{name}} program", program)}
        labelFor={`${program.name}_path`}
      >
        <ControlGroup fill={true} vertical={false}>
          <InputGroup
            fill
            id={`${program.name}_path`}
            readOnly
            placeholder={"..."}
            value={program.path}
          />
          {isLIMA ? null : <Button
            disabled={isLIMA}
            icon={IconNames.LOCATE}
            text={t("Select")}
            title={t("Select program")}
            intent={Intent.PRIMARY}
            onClick={onProgramSelectClick}
          />
          }
        </ControlGroup>
      </FormGroup>
      <FormGroup
        helperText={t("Using automatic value")}
        label={t("Socket path")}
        labelFor={`${program.name}_socket`}
      >
        <ControlGroup fill={true} vertical={false}>
          <InputGroup
            fill
            id={`${program.name}_socket`}
            placeholder={"..."}
            value={socketPath}
            onChange={onSocketPathChange}
            rightElement={
              <Button minimal intent={Intent.PRIMARY} text={t("Test")} onClick={onSocketPathTestClick} />
            }
          />
          <Button icon={IconNames.TICK} text={t("Accept")} title={isSocketPathChanged ? t("Try to use this path") : t("No change detected")} disabled={!isSocketPathChanged} intent={isSocketPathChanged ? Intent.SUCCESS : Intent.NONE} />
        </ControlGroup>
      </FormGroup>
    </div>
  );
}

export const ContainerEngineSettingsPodmanRemote: React.FC<ContainerEngineSettingsProps> = ({}) => {
  return null;
}

export const ContainerEngineSettingsPodmanWSL: React.FC<ContainerEngineSettingsProps> = ({}) => {
  return null;
}

export const ContainerEngineSettingsRegistry: { [key in ContainerEngine]: React.FC<ContainerEngineSettingsProps> } = {
  [ContainerEngine.NATIVE]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.VIRTUALIZED]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.REMOTE]: ContainerEngineSettingsPodmanRemote,
  [ContainerEngine.SUBSYSTEM_LIMA]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.SUBSYSTEM_WSL]: ContainerEngineSettingsPodmanWSL,
  [ContainerEngine.DOCKER]: ContainerEngineSettingsProgramLocal,
}

export interface ContainerEngineManagerProps {
  helperText?: string;
  disabled?: boolean;
}

export const ContainerEngineManager: React.FC<ContainerEngineManagerProps> = ({ disabled, helperText }) => {
  const { t } = useTranslation();
  const platform = useStoreState((state) => state.environment.platform);
  const setUserConfiguration = useStoreActions((actions) => actions.setUserConfiguration);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const ContainerEngines = useMemo(
    () => {
      const engines = [
        { engine: ContainerEngine.NATIVE, label: t("Podman Native"), active: false, enabled: true },
        {
          engine: ContainerEngine.VIRTUALIZED,
          label: t("Podman Machine"),
          active: false,
          enabled: true
        },
        { engine: ContainerEngine.REMOTE, label: t("Podman Remote"), active: false, enabled: false },
        {
          engine: ContainerEngine.SUBSYSTEM_LIMA,
          label: t("Podman on LIMA"),
          active: false,
          enabled: platform === Platforms.Mac
        },
        {
          engine: ContainerEngine.SUBSYSTEM_WSL,
          label: t("Podman on WSL"),
          active: false,
          enabled: platform === Platforms.Windows
        },
        {
          engine: ContainerEngine.DOCKER,
          label: t("Docker (experimental)"),
          active: false,
          enabled: true
        }
      ];
      return engines;
    },
    [t, platform]
  );
  const selectedEngine = userConfiguration.engine;
  const Settings = ContainerEngineSettingsRegistry[userConfiguration.engine];
  const onContainerEngineChange = useCallback((e) => {
    setUserConfiguration({ engine: e.currentTarget.value });
  }, [setUserConfiguration]);
  return (
    <div className="AppSettingsEngineManager">
      <Label>{t("Container environment")} - {helperText}</Label>
      <div className="AppSettingsFormView" data-form-view="container-environment">
        <div className="AppSettingsForm" data-form="engine">
          <FormGroup>
            <RadioGroup
              disabled={disabled}
              className="AppSettingsFormContent"
              data-form="engine"
              onChange={onContainerEngineChange}
              selectedValue={selectedEngine}
            >
              {ContainerEngines.map((it) => {
                let restrict;
                let disabled = !it.enabled;
                const { engine, label } = it;
                if (engine === ContainerEngine.NATIVE) {
                  if (platform === Platforms.Mac || platform === Platforms.Windows) {
                    disabled = true;
                  }
                }
                restrict = <RestrictedTo engine={engine} />;
                return (
                  <Radio
                    key={engine}
                    className={`AppSettingsField ${userConfiguration.engine === it.engine ? "AppSettingsFieldActive" : ""}`}
                    disabled={disabled}
                    labelElement={<RadioLabel text={label} highlight={userConfiguration.engine === it.engine} />}
                    value={engine}
                  >
                    {restrict}
                  </Radio>
                );
              })}
            </RadioGroup>
          </FormGroup>
        </div>
        <div className="AppSettingsForm" data-form="engine.settings">
          <Settings engine={selectedEngine} />
        </div>
      </div>
    </div>
  );
};
