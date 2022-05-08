import { useCallback, useState, useMemo, useEffect } from "react";
import { Button, Checkbox, ControlGroup, InputGroup, Intent, RadioGroup, Radio, FormGroup, Label, HTMLSelect, ButtonGroup, Tab, Tabs } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useForm, useFormContext, FormProvider, Controller } from "react-hook-form";
import merge from "lodash.merge";

// project
import { Connector, ContainerAdapter, ContainerEngine, TestResult, Program, EngineConnectorSettings } from "../../Types";
import { Native, Platforms } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";
import { RadioLabel } from "../../components/RadioLabel";
import { RestrictedTo } from "../../components/RestrictedTo";
import { Notification } from "../../Notification";

import "./EngineManager.css";
import { varKinds } from "ajv/dist/compile/codegen";

interface ContainerEngineSettingsProps {
  connector: Connector;
  disabled?: boolean;
}

export interface ConnectorFormData {
  action: string;
  scope: string; // WSL distribution or LIMA instance
  controllerPath: string;
  programPath: string;
  connectionString: string;
  useAsDefault: boolean;
}

export const ContainerEngineSettingsProgramLocal: React.FC<ContainerEngineSettingsProps> = ({ connector, disabled }) => {
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const { availability, engine, scopes } = connector;
  const { automatic, current } = connector.settings;
  const { api, program, controller } = current;

  const testEngineProgramReachability = useStoreActions((actions) => actions.testEngineProgramReachability);
  const testApiReachability = useStoreActions((actions) => actions.testApiReachability);
  const findProgram = useStoreActions((actions) => actions.findProgram);

  // Form setup
  const { reset, control, getValues, setValue } = useFormContext<ConnectorFormData>();

  useEffect(() => {
    reset({
      scope: controller?.scope,
      controllerPath: controller?.path,
      programPath: program.path,
      connectionString: api.connectionString
    })
  }, [api, controller, program, reset]);

  const onProgramSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const subject = e.currentTarget.getAttribute("data-subject");
      const result = await Native.getInstance().openFileSelector();
      if (result) {
        const filePath = result?.filePaths[0];
        if (!result.canceled && filePath) {
          try {
            if (subject === "program") {
              setValue("programPath", filePath, { shouldDirty: true });
            } else if (subject === "controller") {
              setValue("controllerPath", filePath, { shouldDirty: true });
            }
          } catch (error) {
            console.error("Unable to change CLI path", error);
            Notification.show({ message: t("Unable to change CLI path"), intent: Intent.DANGER });
          }
        }
      } else {
        console.error("Unable to open file dialog");
      }
    },
    [setValue, t]
  );

  const onFindControllerProgram = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const values = getValues();
    const result: Program = await findProgram({
      engine,
      scope: values.scope,
      program: program.name,
    });
    if (result.path) {
      Notification.show({
        message: t(
          "Found {{program}} CLI in {{scope}}",
          { program: program.name, path: program.path, scope: values.scope }
        ),
        intent: Intent.SUCCESS
      });
    } else {
      Notification.show({
        message: t(
          "Unable to find {{program}} CLI in {{scope}}",
          { program: program.name, scope: values.scope }
        ),
        intent: Intent.DANGER
      });
    }
    // setProgram(result);
  }, [engine, program, getValues, findProgram, t]);

  const onProgramPathTestClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const values = getValues();
    const programTest: any = {
      engine,
      scope: values.scope,
      id: connector.id,
      program: {
        ...program,
        path: values.programPath
      }
    };
    if (controller && [ContainerEngine.PODMAN_VIRTUALIZED, ContainerEngine.DOCKER_VIRTUALIZED].includes(engine)) {
      programTest.controller = {
        ...controller,
        path: values.controllerPath
      };
    }
    const result: TestResult = await testEngineProgramReachability(programTest);
    if (result.success) {
      Notification.show({ message: t("Program was reached successfully"), intent: Intent.SUCCESS });
    } else {
      Notification.show({ message: t("Program could not be reached"), intent: Intent.DANGER });
    }
  }, [engine, program, controller, connector, testEngineProgramReachability, getValues, t]);

  const onConnectionStringTestClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const values = getValues();
    const result: TestResult = await testApiReachability({
      engine,
      scope: values.scope,
      id: connector.id,
       ...api,
       connectionString: values.connectionString
    });
    if (result.success) {
      Notification.show({ message: t("API was reached successfully"), intent: Intent.SUCCESS });
    } else {
      Notification.show({ message: t("API could not be reached"), intent: Intent.DANGER });
    }
  }, [engine, api, connector, testApiReachability, getValues, t]);

  // locals
  const isLIMA = [ContainerEngine.PODMAN_SUBSYSTEM_LIMA, ContainerEngine.DOCKER_SUBSYSTEM_LIMA].includes(engine);
  const isWSL = [ContainerEngine.PODMAN_SUBSYSTEM_WSL, ContainerEngine.DOCKER_SUBSYSTEM_WSL].includes(engine);
  const isMachine = [ContainerEngine.PODMAN_VIRTUALIZED].includes(engine);
  const isScoped = isLIMA || isWSL || isMachine;

  let scopeSelectorWidget: any = undefined;
  if (isScoped && Array.isArray(scopes)) {
    let scopeLabel = t("Scope");
    let scopeTitle = "";
    if (isLIMA) {
      scopeLabel = t("LIMA instance");
      scopeTitle = t("The LIMA instance in which the current engine is running");
    } else if (isWSL) {
      scopeLabel = t("WSL distribution");
      scopeTitle = t("The WSL distribution in which the current engine is running");
    } else if (isMachine) {
      scopeLabel = t("Podman machines");
      scopeTitle = t("The podman machine in which the current engine is running");
    }
    scopeSelectorWidget = (
      <Controller
        control={control}
        name="scope"
        defaultValue=""
        rules={{ required: isScoped ? t("Controller path must be set") : false }}
        render={({ field: { onChange, onBlur, value, name, ref, }, fieldState: { isDirty, error } }) => {
          return (
            <FormGroup className="ProgramScopeLocator" label={scopeLabel} labelFor="scopeSelector">
              <ControlGroup>
                <HTMLSelect
                  name={name}
                  id={name}
                  ref={ref}
                  title={scopeTitle}
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                >
                  <option value="">{t("-- select --")}</option>
                  {scopes.map((it) => {
                    return (
                      <option key={it.Name} value={it.Name}>{it.Name}</option>
                    );
                  })}
                </HTMLSelect>
                <Button
                  className="ScopeSelectorFindButton"
                  minimal
                  disabled={!value}
                  icon={IconNames.TARGET}
                  intent={Intent.PRIMARY}
                  title={t("Click to trigger automatic detection")}
                  onClick={onFindControllerProgram}
              />
              </ControlGroup>
            </FormGroup>
          );
        }}
      />
    );
  }

  let programWidget;
  if (isScoped && !(isLIMA || isWSL)) {
    programWidget = (
      <Controller
        control={control}
        name="controllerPath"
        defaultValue=""
        rules={{ required: t("Controller path must be set") }}
        render={({ field: { onChange, onBlur, value, name, ref, }, fieldState: { isDirty, error } }) => {
          let valid = true;
          let message;
          if (error?.message) {
            message = error.message;
            valid = false;
          }
          if (valid) {
            valid = !!availability.controller;
          }
          if (!availability.controller) {
            message = availability.report.controller;
          }
          let helperText = availability.controller ? (
            <div className="AppSettingsFieldProgramHelper">
              {controller?.version ? (
                <>
                  <span>{t("Detected version {{version}}", controller)}</span>
                </>
              ) : (
                t("Could not detect current version")
              )}
            </div>
          ) : message;
          if (isDirty) {
            helperText = t("Version needs detection");
          }
          let controllerPathLabel = t("Path to {{name}} CLI", controller);
          if (isScoped) {
            if (isMachine) {
              controllerPathLabel = t("Path to native {{name}} CLI", controller);
            } else if (isWSL) {
              controllerPathLabel = t("Path to WSL distribution {{name}} CLI", controller);
            } else if (isLIMA) {
              controllerPathLabel = t("Path to LIMA instance {{name}} CLI", controller);
            }
          }
          let programSelectButton;
          if (!isScoped || (isScoped && isMachine)) {
            programSelectButton = (
              <Button
                icon={IconNames.LOCATE}
                text={t("Select")}
                title={t("Select controller")}
                intent={Intent.PRIMARY}
                data-subject="controller"
                onClick={onProgramSelectClick}
              />
            );
          }
          return (
            <div className="ProgramLocator">
              {scopeSelectorWidget}
              <FormGroup
                helperText={helperText}
                label={controllerPathLabel}
                labelFor="controllerPath"
                className="ProgramPathLocator"
              >
                <ControlGroup fill={true} vertical={false}>
                  <InputGroup
                    fill
                    id={name}
                    name={name}
                    inputRef={ref}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    placeholder={automatic.controller?.path || ""}
                    intent={valid ? undefined : Intent.DANGER}
                    title={message}
                    rightElement={
                      <>
                        <Button disabled={value.length === 0 || pending} minimal intent={Intent.PRIMARY} text={t("Test")} onClick={onProgramPathTestClick} />
                      </>
                    }
                  />
                  {programSelectButton}
                </ControlGroup>
              </FormGroup>
            </div>
          );
        }}
      />
    );
  } else {
    programWidget = (
      <Controller
        control={control}
        name="programPath"
        defaultValue=""
        rules={{ required: t("Program path must be set") }}
        render={({ field: { onChange, onBlur, value, name, ref, }, fieldState: { isDirty, error } }) => {
          let valid = true;
          let message;
          if (error?.message) {
            message = error.message;
            valid = false;
          }
          if (valid) {
            valid = availability.program;
          }
          if (!availability.program) {
            message = availability.report.program;
          }
          let helperText = availability.program ? (
            <div className="AppSettingsFieldProgramHelper">
              {program?.version ? (
                <>
                  <span>{t("Detected version {{version}}", program)}</span>
                </>
              ) : (
                t("Could not detect current version")
              )}
            </div>
          ) : message;
          if (isDirty) {
            helperText = t("Version needs detection");
          }
          return (
            <div className="ProgramLocator">
              {scopeSelectorWidget}
              <FormGroup
                helperText={helperText}
                label={t("Path to {{name}} CLI", program)}
                labelFor="programPath"
                className="ProgramPathLocator"
              >
                <ControlGroup fill={true} vertical={false}>
                  <InputGroup
                    fill
                    id={name}
                    name={name}
                    inputRef={ref}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    placeholder={automatic.program?.path || ""}
                    intent={valid ? undefined : Intent.DANGER}
                    title={message}
                    rightElement={
                      <Button disabled={value.length === 0 || pending} minimal intent={Intent.PRIMARY} text={t("Test")} onClick={onProgramPathTestClick} />
                    }
                  />
                  {isScoped ? null : <Button
                    icon={IconNames.LOCATE}
                    text={t("Select")}
                    title={t("Select program")}
                    intent={Intent.PRIMARY}
                    data-subject="program"
                    onClick={onProgramSelectClick}
                  />
                  }
                </ControlGroup>
              </FormGroup>
            </div>
          );
        }}
      />
    );
  }

  return (
    <div className="ContainerEngineSettings" data-settings="program.local">

      {programWidget}

      <Controller
        control={control}
        name="connectionString"
        defaultValue=""
        rules={{ required: t("Connection string must be set") }}
        render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { isDirty, error, invalid } }) => {
          let helperText = "";
          if (value && automatic.api?.connectionString) {
            if (automatic.api?.connectionString !== value) {
              helperText = t("Overriding default");
            }
          }
          let valid = true;
          let message;
          if (error?.message) {
            message = error.message;
            valid = false;
          }
          if (valid) {
            valid = availability.api;
          }
          if (!availability.api) {
            message = availability.report.api;
          } else {
            message = helperText || availability.report.api;
          }
          if (isDirty) {
            message = t("Reachability test is needed");
          }
          return (
            <FormGroup
              label={t("Connection string")}
              labelFor="connectionString"
              helperText={message}
            >
              <ControlGroup fill={true} vertical={false}>
                <InputGroup
                  fill
                  id={name}
                  name={name}
                  inputRef={ref}
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  placeholder={automatic.api?.connectionString || ""}
                  intent={valid ? undefined : Intent.DANGER}
                  title={message}
                  rightElement={
                    <ButtonGroup>
                      <Button disabled={!!error || pending} minimal intent={Intent.PRIMARY} text={t("Test")} onClick={onConnectionStringTestClick} />
                    </ButtonGroup>
                  }
                />
              </ControlGroup>
            </FormGroup>
          );
        }}
      />
    </div>
  );
}

export const ContainerEngineSettingsPodmanRemote: React.FC<ContainerEngineSettingsProps> = () => {
  return null;
}

export type ContainerEngineSettingsRegistryStore = { [key in ContainerEngine]: React.FC<ContainerEngineSettingsProps> };
export const ContainerEngineSettingsRegistry: ContainerEngineSettingsRegistryStore = {
  [ContainerEngine.PODMAN_NATIVE]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_VIRTUALIZED]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_REMOTE]: ContainerEngineSettingsPodmanRemote,
  [ContainerEngine.PODMAN_SUBSYSTEM_LIMA]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.PODMAN_SUBSYSTEM_WSL]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER_NATIVE]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER_VIRTUALIZED]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER_REMOTE]: ContainerEngineSettingsPodmanRemote,
  [ContainerEngine.DOCKER_SUBSYSTEM_LIMA]: ContainerEngineSettingsProgramLocal,
  [ContainerEngine.DOCKER_SUBSYSTEM_WSL]: ContainerEngineSettingsProgramLocal,
}

export interface ContainerEngineItem {
  adapter: ContainerAdapter;
  engine: ContainerEngine;
  label: string;
  active: boolean;
  enabled: boolean;
}

export interface ContainerEngineManagerSettingsProps {
  adapter: ContainerAdapter;
  disabled?: boolean;
  connectors: Connector[];
  currentConnector: Connector;
  engines: ContainerEngineItem[];
}
export const ContainerEngineManagerSettings: React.FC<ContainerEngineManagerSettingsProps> = ({ adapter, disabled, connectors, currentConnector, engines }) => {
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const defaultConnector = useStoreState((state) => state.descriptor.userSettings.connector.default);
  const start = useStoreActions((actions) => actions.start);
  const setGlobalUserSettings = useStoreActions((actions) => actions.setGlobalUserSettings);
  const setEngineUserSettings = useStoreActions((actions) => actions.setEngineUserSettings);
  const [selectedConnectorId, setSelectedConnectorId] = useState(currentConnector.id);

  // if no connector found - pick first usable
  let connector = connectors.find(it => it.id === selectedConnectorId);
  if (!connector) {
    connector = connectors.find(({ availability }) => {
      let usable = availability.api;
      if (typeof availability.controller !== "undefined") {
        usable = availability.controller;
      }
      return usable;
    });
  }

  const methods = useForm<ConnectorFormData>({
    mode: "all",
    reValidateMode: "onChange",
    shouldUseNativeValidation: false,
    defaultValues: {
      scope: currentConnector.settings.current.controller?.scope,
      controllerPath: currentConnector.settings.current.controller?.path,
      programPath: currentConnector.settings.current.program.path,
      connectionString: currentConnector.settings.current.api.connectionString
    },
    criteriaMode: "firstError"
  });

  const { reset, formState, handleSubmit } = methods;

  const onContainerEngineChange = useCallback((e) => {
    setSelectedConnectorId(e.currentTarget.value);
  }, []);

  const onSaveClick = handleSubmit(async (data) => {
    if (!connector) {
      return;
    }
    // setEngineUserSettings
    const engineUserSettings: Partial<EngineConnectorSettings> = {
      program: merge(
        {},
        connector.settings.current.program,
        {
          path: data.programPath,
        }
      ),
      api: merge(
        {},
        connector.settings.current.api,
        {
          connectionString: data.connectionString,
        }
      ),
    };
    if (connector.settings.current.controller) {
      engineUserSettings.controller = merge(
        {},
        connector.settings.current.controller,
        {
          path: data.controllerPath,
        }
      );
    }
    try {
      const settings: EngineConnectorSettings = await setEngineUserSettings({ id: connector.id, settings: engineUserSettings });
      reset({
        scope: currentConnector.settings.current.controller?.scope,
        controllerPath: currentConnector.settings.current.controller?.path,
        programPath: settings.program.path,
        connectionString: settings.api.connectionString
      });
      Notification.show({ message: t("Container engine settings have been updated"), intent: Intent.SUCCESS });
    } catch (error) {
      Notification.show({ message: t("Container engine settings update has failed"), intent: Intent.DANGER });
    }
  });

  const onConnectClick = handleSubmit(async (data) => {
    if (connector) {
      await start({ startApi: true, adapter, connector: connector.id });
    }
    return true;
  });

  const onResetClick = handleSubmit(async (data) => {
    if (!connector) {
      return;
    }
    try {
      const settings: EngineConnectorSettings = await setEngineUserSettings({ id: connector.id, settings: connector?.settings.automatic });
      reset({
        programPath: settings.program.path,
        connectionString: settings.api.connectionString
      });
      Notification.show({ message: t("Container engine settings have been reset"), intent: Intent.SUCCESS });
    } catch (error) {
      Notification.show({ message: t("Container engine settings reset has failed"), intent: Intent.DANGER });
    }
    return true;
  });

  const onUseAsDefaultChange = useCallback(async (e) => {
    const isChecked = e.currentTarget.checked;
    await setGlobalUserSettings({ connector: { default: isChecked ? connector?.id : undefined } });
  }, [setGlobalUserSettings, connector]);

  const canAct = formState.isValid && !pending;
  const canSave = canAct && formState.isDirty && !pending;
  const canReset = !pending;
  const isDefaultConnector = connector && defaultConnector === connector.id;

  let settingsWidget: any = null;
  if (connector && ContainerEngineSettingsRegistry[connector.engine]) {
    const Settings = ContainerEngineSettingsRegistry[connector.engine];
    settingsWidget = <Settings connector={connector} />;
  }

  return (
    <FormProvider {...methods}>
      <form>
        <div className="AppSettingsFormView" data-form-view="container-engine" data-adapter={adapter}>
          <div className="AppSettingsFormViewBody">
            <div className="AppSettingsForm" data-form="engine">
              <FormGroup>
                <RadioGroup
                  disabled={disabled}
                  className="AppSettingsFormContent"
                  data-form="engine"
                  onChange={onContainerEngineChange}
                  selectedValue={connector?.id}
                >
                  {engines.map((containerEngine) => {
                    const engineConnector = connectors.find(it => it.engine === containerEngine.engine);
                    const label = containerEngine ? containerEngine.label : "Unsupported";
                    const disabled = containerEngine ? !containerEngine.enabled : true;
                    const restrict = <RestrictedTo engine={containerEngine.engine} />;
                    const important = defaultConnector !== undefined && defaultConnector === engineConnector?.id;
                    return (
                      <Radio
                        key={containerEngine.engine}
                        data-adapter={containerEngine.adapter}
                        data-engine={containerEngine.engine}
                        className={`AppSettingsField ${connector?.id === engineConnector?.id ? "AppSettingsFieldActive" : ""}`}
                        disabled={disabled}
                        labelElement={<RadioLabel text={label} important={important} highlight={currentConnector.id === engineConnector?.id} />}
                        value={engineConnector?.id}
                      >
                        {restrict}
                      </Radio>
                    );
                  })}
                </RadioGroup>
              </FormGroup>
            </div>
            <div className="AppSettingsForm" data-form="engine.settings">
              {settingsWidget}
            </div>
          </div>
          <div className="AppSettingsFormViewFooter">
            <ButtonGroup className="ContainerEngineSettingsActions">
              <Button disabled={!canAct} intent={Intent.SUCCESS} text={t("Connect")} icon={IconNames.DATA_CONNECTION} onClick={onConnectClick} />
              <Button disabled={!canSave} intent={Intent.PRIMARY} text={t("Save")} icon={IconNames.FLOPPY_DISK} onClick={onSaveClick} />
            </ButtonGroup>
            <FormGroup className="ContainerEngineSettingsSetDefault">
              <ControlGroup>
                <Checkbox
                  label={t("Use as default")}
                  onChange={onUseAsDefaultChange}
                  checked={isDefaultConnector}
                />
              </ControlGroup>
            </FormGroup>
            <div className="ContainerEngineSettingsActionsSpacer"></div>
            <Button data-action="reset" disabled={!canReset} minimal intent={Intent.NONE} title={t("Reset to automatic values")} icon={IconNames.RESET} onClick={onResetClick} />
          </div>
        </div>
      </form>
    </FormProvider>
  );
}

export interface ContainerEngineManagerProps {
  helperText?: string;
  disabled?: boolean;
}

export const ContainerEngineManager: React.FC<ContainerEngineManagerProps> = ({ disabled, helperText }) => {
  const { t } = useTranslation();
  const platform = useStoreState((state) => state.descriptor.platform);
  const currentConnector = useStoreState((state) => state.descriptor.currentConnector);
  const PodmanContainerEngines = useMemo(
    () => {
      const engines = [
        // Podman
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_NATIVE,
          label: t("Native"),
          active: false,
          enabled: platform === Platforms.Linux
        },
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_VIRTUALIZED,
          label: t("Virtualized"),
          active: false,
          enabled: true
        },
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_REMOTE,
          label: t("Remote"),
          active: false,
          enabled: false
        },
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_SUBSYSTEM_LIMA,
          label: t("Custom LIMA"),
          active: false,
          enabled: platform === Platforms.Mac
        },
        {
          adapter: ContainerAdapter.PODMAN,
          engine: ContainerEngine.PODMAN_SUBSYSTEM_WSL,
          label: t("Custom WSL"),
          active: false,
          enabled: platform === Platforms.Windows
        },
      ];
      return engines;
    },
    [t, platform]
  );
  const DockerContainerEngines = useMemo(
    () => {
      const engines = [
        // Docker
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_NATIVE,
          label: t("Native"),
          active: false,
          enabled: platform === Platforms.Linux
        },
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_VIRTUALIZED,
          label: t("Virtualized"),
          active: false,
          enabled: platform === Platforms.Windows || platform === Platforms.Mac
        },
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_REMOTE,
          label: t("Remote"),
          active: false,
          enabled: false
        },
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_SUBSYSTEM_LIMA,
          label: t("Custom LIMA"),
          active: false,
          enabled: platform === Platforms.Mac
        },
        {
          adapter: ContainerAdapter.DOCKER,
          engine: ContainerEngine.DOCKER_SUBSYSTEM_WSL,
          label: t("Custom WSL"),
          active: false,
          enabled: platform === Platforms.Windows
        },
      ];
      return engines;
    },
    [t, platform]
  );

  const adapter = useStoreState((state) => state.descriptor.currentConnector.adapter);
  const [containerAdapter, setContainerAdapter] = useState(adapter || ContainerAdapter.PODMAN);
  const onContainerAdapterChange = useCallback((e) => {
    setContainerAdapter(e);
  }, []);

  const connectors = useStoreState((state) => state.descriptor.connectors);
  const podmanConnectors = useMemo(() => connectors.filter(it => it.engine.startsWith(containerAdapter)), [connectors, containerAdapter]);
  const dockerConnectors = useMemo(() => connectors.filter(it => it.engine.startsWith(containerAdapter)), [connectors, containerAdapter]);

  useEffect(() => {
    setContainerAdapter(adapter);
  }, [adapter]);

  return (
    <div className="AppSettingsEngineManager">
      <Tabs selectedTabId={containerAdapter} onChange={onContainerAdapterChange} renderActiveTabPanelOnly>
        <Tab id={ContainerAdapter.PODMAN} title={t("Podman")} panelClassName="podman-panel" panel={<ContainerEngineManagerSettings adapter={ContainerAdapter.PODMAN} currentConnector={currentConnector} engines={PodmanContainerEngines} connectors={podmanConnectors} />} />
        <Tab id={ContainerAdapter.DOCKER} title={t("Docker")} panelClassName="docker-panel" panel={<ContainerEngineManagerSettings adapter={ContainerAdapter.DOCKER} currentConnector={currentConnector} engines={DockerContainerEngines} connectors={dockerConnectors} />} />
        <Tabs.Expander />
        <Label>{helperText}</Label>
      </Tabs>
    </div>
  );
};
