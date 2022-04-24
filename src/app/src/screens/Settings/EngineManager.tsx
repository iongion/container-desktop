import { useCallback, useState, useMemo } from "react";
import { Button, ControlGroup, InputGroup, Intent, RadioGroup, Radio, FormGroup, Label, HTMLSelect, ButtonGroup } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";

// project
import { ContainerEngine, TestResult, Program } from "../../Types";
import { Native, Platforms } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";
import { RadioLabel } from "../../components/RadioLabel";
import { RestrictedTo } from "../../components/RestrictedTo";
import { Notification } from "../../Notification";

import "./EngineManager.css";

interface ContainerEngineSettingsProps {
  engine: ContainerEngine;
  disabled?: boolean;
}

export const ContainerEngineSettingsProgramLocal: React.FC<ContainerEngineSettingsProps> = ({ engine, disabled }) => {
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const connect = useStoreActions((actions) => actions.connect);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const wslDistributions = useStoreState((state) => state.environment.wslDistributions);
  const setUserConfiguration = useStoreActions((actions) => actions.setUserConfiguration);
  const testConnectionString = useStoreActions((actions) => actions.testConnectionString);
  const findProgram = useStoreActions((actions) => actions.findProgram);
  const start = useStoreActions((actions) => actions.start);
  const [program, setProgram] = useState(userConfiguration.program);
  const [selectedWSLDistribution, setSelectedWSLDistribution] = useState<string>(wslDistributions.find(it => it.Current)?.Name || "");
  const [connectionString, setConnectionString] = useState(userConfiguration.connectionString);
  const onProgramSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const result = await Native.getInstance().openFileSelector();
      if (result) {
        const filePath = result?.filePaths[0];
        if (!result.canceled && filePath) {
          try {
            const program = filePath.split(/\\|\//).pop()?.replace(".exe", "") || "";
            const programSettings: any = {};
            const programKey = `${engine}.program.${program}.path`;
            programSettings[programKey] = filePath;
            await setUserConfiguration(programSettings);
          } catch (error) {
            console.error("Unable to change CLI path", error);
            Notification.show({ message: t("Unable to change CLI path"), intent: Intent.DANGER });
          }
        }
      } else {
        console.error("Unable to open file dialog");
      }
    },
    [engine, setUserConfiguration, t]
  );
  const onWSLDistributionChange = useCallback(
    (event: React.FormEvent<HTMLSelectElement>) => {
      const sender = event.currentTarget;
      setSelectedWSLDistribution(sender.value);
    },
    [setSelectedWSLDistribution]
  );
  const onConnectionStringChange = useCallback(
    (event: React.FormEvent<HTMLInputElement>) => {
      const sender = event.currentTarget;
      setConnectionString(sender.value);
    },
    [setConnectionString]
  );
  const onFindWSLProgramClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const result: Program = await findProgram({
      engine,
      wslDistributionName: selectedWSLDistribution,
      program: program.name,
    });
    if (result.path) {
      Notification.show({
        message: t(
          "Found {{program}} CLI in {{distribution}} WLS distribution",
          { program: program.name, path: program.path, distribution: selectedWSLDistribution }
        ),
        intent: Intent.SUCCESS
      });
    } else {
      Notification.show({
        message: t(
          "Unable to find {{program}} CLI in {{distribution}} WSL distribution",
          { program: program.name, distribution: selectedWSLDistribution }
        ),
        intent: Intent.DANGER
      });
    }
    setProgram(result);
  }, [engine, program, selectedWSLDistribution, findProgram, t]);
  const onConnectionStringTestClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const result: TestResult = await testConnectionString(connectionString);
    if (result.success) {
      Notification.show({ message: t("API was reached successfully"), intent: Intent.SUCCESS });
    } else {
      Notification.show({ message: t("API could not be reached"), intent: Intent.DANGER });
    }
  }, [connectionString, testConnectionString, t]);
  const onConnectionStringAcceptClick = useCallback(async () => {
    try {
      const result: TestResult = await testConnectionString(connectionString);
      if (result.success) {
        const programSettings: any = {};
        const programKey = `${engine}.program.${program.name}.connectionString`;
        programSettings[programKey] = connectionString.replace("unix://", "").replace("npipe://", "");
        await setUserConfiguration(programSettings);
        Notification.show({ message: t("Connection string has been customized"), intent: Intent.SUCCESS });
        await start();
      } else {
        Notification.show({ message: t("Connection string customization failed - API could not be reached"), intent: Intent.DANGER });
      }
    } catch (error) {
      console.error("Unable to change CLI path", error);
      Notification.show({ message: t("Connection string customization failed"), intent: Intent.DANGER });
    }
  }, [engine, connectionString, program, testConnectionString, setUserConfiguration, start, t]);
  const onConnectClick = useCallback(
    async () => {
      await connect({ startApi: true, engine });
    },
    [connect, engine]
  );
  // locals
  const isConnectionStringChanged = connectionString !== userConfiguration.connectionString;
  const isLIMA = engine === ContainerEngine.PODMAN_SUBSYSTEM_LIMA;
  const suffix = isLIMA ? <span> - {t("Automatically detected inside LIMA VM")}</span> : "";
  const isWSL = engine === ContainerEngine.PODMAN_SUBSYSTEM_WSL;
  const canConnect = !pending && !!program.path;
  let wslSelector;
  if (isWSL) {
    wslSelector = (
      <div className="WSLSelector">
        <HTMLSelect
          id="wsl_distribution"
          name="wsl_distribution"
          title={t("WSL distribution")}
          value={selectedWSLDistribution}
          onChange={onWSLDistributionChange}
        >
          <option value="">{t("-- select --")}</option>
          {wslDistributions.map((it) => {
            return (
              <option key={it.Name} value={it.Name}>{it.Name}</option>
            );
          })}
        </HTMLSelect>
        <Button
          disabled={!selectedWSLDistribution}
          icon={IconNames.TARGET}
          text={t("Find")}
          intent={Intent.PRIMARY}
          title={t("Click to trigger automatic detection")}
          onClick={onFindWSLProgramClick}
        />
      </div>
    );
  }
  return (
    <div className="ContainerEngineSettings" data-settings="program.local">
      <FormGroup
        helperText={
          <div className="AppSettingsFieldProgramHelper">
            {program?.currentVersion ? (
              <>
                <span>{t("Detected version {{currentVersion}}", program)}</span>
                {suffix}
              </>
            ) : (
              t("Could not detect current version")
            )}
          </div>
        }
        label={t("Path to {{name}} CLI", program)}
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
          {isLIMA || isWSL ? null : <Button
            icon={IconNames.LOCATE}
            text={t("Select")}
            title={t("Select program")}
            intent={Intent.PRIMARY}
            onClick={onProgramSelectClick}
          />
          }
          {wslSelector}
        </ControlGroup>
      </FormGroup>
      <FormGroup
        helperText={t("NOTE - Custom connection string is reset on environment change due to auto-detection.")}
        label={t("Connection string")}
        labelFor={`${program.name}_socket`}
      >
        <ControlGroup fill={true} vertical={false}>
          <InputGroup
            fill
            id={`${program.name}_socket`}
            placeholder={"..."}
            value={connectionString}
            onChange={onConnectionStringChange}
            rightElement={
              <Button minimal intent={Intent.PRIMARY} text={t("Test")} onClick={onConnectionStringTestClick} />
            }
          />
          <Button
            icon={IconNames.TICK}
            text={t("Accept")}
            title={isConnectionStringChanged ? t("Try to use this value") : t("No change detected")}
            disabled={!isConnectionStringChanged}
            intent={isConnectionStringChanged ? Intent.SUCCESS : Intent.NONE}
            onClick={onConnectionStringAcceptClick}
          />
        </ControlGroup>
      </FormGroup>
      <ButtonGroup className="ContainerEngineSettingsActions">
        <Button disabled={!canConnect} intent={Intent.PRIMARY} text={t("Save")} icon={IconNames.FLOPPY_DISK} onClick={onConnectClick} />
        <Button disabled={!canConnect} intent={Intent.SUCCESS} text={t("Connect")} icon={IconNames.DATA_CONNECTION} onClick={onConnectClick} />
      </ButtonGroup>
    </div>
  );
}

export const ContainerEngineSettingsPodmanRemote: React.FC<ContainerEngineSettingsProps> = () => {
  return null;
}

export const ContainerEngineSettingsRegistry: { [key in ContainerEngine]: React.FC<ContainerEngineSettingsProps> } = {
  [ContainerEngine.PODMAN_NATIVE]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_VIRTUALIZED]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_REMOTE]: ContainerEngineSettingsPodmanRemote,
  [ContainerEngine.PODMAN_SUBSYSTEM_LIMA]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_SUBSYSTEM_WSL]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER]: ContainerEngineSettingsProgramLocal,
}

export interface ContainerEngineManagerProps {
  helperText?: string;
  disabled?: boolean;
}

export const ContainerEngineManager: React.FC<ContainerEngineManagerProps> = ({ disabled, helperText }) => {
  const { t } = useTranslation();
  const platform = useStoreState((state) => state.environment.platform);
  const userConfiguration = useStoreState((state) => state.environment.userConfiguration);
  const ContainerEngines = useMemo(
    () => {
      const engines = [
        { engine: ContainerEngine.PODMAN_NATIVE, label: t("Podman Native"), active: false, enabled: true },
        {
          engine: ContainerEngine.PODMAN_VIRTUALIZED,
          label: t("Podman Machine"),
          active: false,
          enabled: true
        },
        { engine: ContainerEngine.PODMAN_REMOTE, label: t("Podman Remote"), active: false, enabled: false },
        {
          engine: ContainerEngine.PODMAN_SUBSYSTEM_LIMA,
          label: t("Podman on LIMA"),
          active: false,
          enabled: platform === Platforms.Mac
        },
        {
          engine: ContainerEngine.PODMAN_SUBSYSTEM_WSL,
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
  const [selectedEngine, setSelectedEngine] = useState(userConfiguration.engine);
  const Settings = ContainerEngineSettingsRegistry[userConfiguration.engine];
  const onContainerEngineChange = useCallback((e) => {
    setSelectedEngine(e.currentTarget.value);
  }, []);
  return (
    <div className="AppSettingsEngineManager">
      <Label>{t("Container engine")} - {helperText}</Label>
      <div className="AppSettingsFormView" data-form-view="container-engine">
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
                if (engine === ContainerEngine.PODMAN_NATIVE) {
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
