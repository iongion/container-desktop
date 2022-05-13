import { useCallback, useState, useMemo, useEffect } from "react";
import { Button, Checkbox, ControlGroup, InputGroup, Intent, RadioGroup, Radio, FormGroup, Label, HTMLSelect, ButtonGroup, Tab, Tabs } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useTranslation } from "react-i18next";
import { useForm, useFormContext, FormProvider, Controller } from "react-hook-form";
import merge from "lodash.merge";

// project
import { Platforms, Connector, ContainerAdapter, ContainerEngine, TestResult, ProgramTestResult, Program, EngineProgramOptions, EngineConnectorSettings, ControllerScope } from "../../Types.container-app";
import { Native } from "../../Native";
import { useStoreActions, useStoreState } from "../../domain/types";
import { RadioLabel } from "../../components/RadioLabel";
import { RestrictedTo } from "../../components/RestrictedTo";
import { Notification } from "../../Notification";

import "./EngineManager.css";

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


const coerceScope = (scope: string | undefined, scopes?: ControllerScope[]) => {
  if (scope === undefined) {
    return "";
  }
  const isPresent = !!(scopes || []).find(it => it.Name === scope);
  // console.debug("isPresent", { isPresent, scope });
  return isPresent ? scope : "";
};

export const ContainerEngineSettingsProgramLocal: React.FC<ContainerEngineSettingsProps> = ({ connector, disabled }) => {
  const { t } = useTranslation();
  const pending = useStoreState((state) => state.pending);
  const { availability, engine, scopes } = connector;
  const { expected, current } = connector.settings;
  const { api, program, controller } = current;

  const testProgramReachability = useStoreActions((actions) => actions.testProgramReachability);
  const testApiReachability = useStoreActions((actions) => actions.testApiReachability);
  const findProgram = useStoreActions((actions) => actions.findProgram);
  const connectorUpdate = useStoreActions((actions) => actions.connectorUpdate);

  // Form setup
  const { reset, control, getValues, setValue } = useFormContext<ConnectorFormData>();

  // State
  const [programTestResult, setProgramTestResult] = useState<ProgramTestResult>();

  const programScopes = scopes || [];

  // locals
  const isLIMA = [ContainerEngine.PODMAN_SUBSYSTEM_LIMA, ContainerEngine.DOCKER_SUBSYSTEM_LIMA].includes(engine);
  const isWSL = [ContainerEngine.PODMAN_SUBSYSTEM_WSL, ContainerEngine.DOCKER_SUBSYSTEM_WSL].includes(engine);
  const isMachine = [ContainerEngine.PODMAN_VIRTUALIZED].includes(engine);
  const isScoped = isLIMA || isWSL || isMachine;

  useEffect(() => {
    let controllerPath = controller?.path || "";
    reset({
      scope: coerceScope(controller?.scope, scopes),
      controllerPath: controllerPath,
      programPath: program.path,
      connectionString: api.connectionString
    });
  }, [api, controller, program, scopes, reset]);

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
      id: connector.id,
      program: program.name,
    });
    if (result && result.path) {
      Notification.show({
        message: t(
          "Found {{program}} CLI in {{scope}} on {{path}} {{version}}",
          { program: program.name, path: result.path, version: result.version, scope: values.scope }
        ),
        intent: Intent.SUCCESS
      });
      setValue("programPath", result.path, { shouldDirty: true });
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
  }, [engine, program, connector, getValues, setValue, findProgram, t]);

  const onProgramPathTestClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const values = getValues();
    const programTest: EngineProgramOptions = {
      adapter: connector.adapter,
      engine,
      id: connector.id,
      program: {
        path: values.programPath
      }
    };
    if (controller) {
      programTest.controller = {
        path: values.controllerPath,
        scope: values.scope,
      };
    }
    const result: ProgramTestResult = await testProgramReachability(programTest);
    if (result.success) {
      Notification.show({ message: t("Program was reached successfully"), intent: Intent.SUCCESS });
    } else {
      Notification.show({ message: t("Program could not be reached"), intent: Intent.DANGER });
    }

    const currentConnector = { ...connector };
    if (controller) {
      if (currentConnector.settings.user.controller) {
        currentConnector.settings.user.controller.path = result.program?.path;
        currentConnector.settings.user.controller.version = result.program?.version;
        currentConnector.scopes = result.scopes || [];
      }
      currentConnector.availability.controller = result.success;
    } else {
      if (currentConnector.settings.user.program) {
        currentConnector.settings.user.program.path = result.program?.path;
        currentConnector.settings.user.program.version = result.program?.version;
      }
      currentConnector.availability.program = result.success;
    }
    const updated = await connectorUpdate(currentConnector);
    console.debug("connector update", updated);
    setProgramTestResult(result);
  }, [engine, controller, connector, testProgramReachability, getValues, t, connectorUpdate]);

  const onConnectionStringTestClick = useCallback(async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
    const values = getValues();
    const result: TestResult = await testApiReachability({
      adapter: connector.adapter,
      engine,
      scope: values.scope,
      id: connector.id,
      baseURL: api.baseURL,
      connectionString: values.connectionString
    });
    if (result.success) {
      Notification.show({ message: t("API was reached successfully"), intent: Intent.SUCCESS });
    } else {
      Notification.show({ message: t("API could not be reached"), intent: Intent.DANGER });
    }
  }, [engine, connector, api, testApiReachability, getValues, t]);

  let scopeSelectorWidget: any = undefined;
  let scopeSelectorHelperText = "";
  if (isScoped && Array.isArray(programScopes)) {
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
      scopeSelectorHelperText = programScopes.length ? "" : t("Podman machine is required");
    }
    scopeSelectorWidget = (
      <Controller
        control={control}
        name="scope"
        defaultValue=""
        rules={{ required: true }}
        render={({ field: { onChange, onBlur, value, name, ref, }, fieldState: { isDirty, error } }) => {
          if (!value) {
            if (isLIMA) {
              scopeSelectorHelperText = t("A LIMA instance is required");
            } else if (isWSL) {
              scopeSelectorHelperText = t("A WSL distribution is required");
            } else if (isMachine) {
              scopeSelectorHelperText = t("Podman machine is required");
            }
          }
          return (
            <FormGroup className="ProgramScopeLocator" label={scopeLabel} labelFor="scopeSelector" intent={Intent.DANGER} helperText={scopeSelectorHelperText}>
              <ControlGroup>
                <HTMLSelect
                  name={name}
                  id={name}
                  ref={ref}
                  title={scopeTitle}
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  disabled={pending}
                >
                  <option value="">{t("-- select --")}</option>
                  {programScopes.map((it) => {
                    return (
                      <option key={it.Name} value={it.Name}>{it.Name}</option>
                    );
                  })}
                </HTMLSelect>
                <Button
                  className="ScopeSelectorFindButton"
                  minimal
                  disabled={!value || pending}
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
                <span>{t("Detected version {{version}}", controller)}</span>
              ) : (
                t("Could not detect current version")
              )}
            </div>
          ) : message;
          if (programTestResult && programTestResult.program?.path === value) {
            if (programTestResult.success) {
              helperText = t("Detected version {{version}}", programTestResult.program);
            } else {
              helperText = t("No valid version");
            }
          } else if (isDirty) {
            helperText = t("Version needs detection - press Test");
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
                disabled={pending}
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
                    disabled={pending}
                    fill
                    id={name}
                    name={name}
                    inputRef={ref}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    placeholder={expected.controller?.path || ""}
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
                    disabled={pending}
                    fill
                    id={name}
                    name={name}
                    inputRef={ref}
                    value={value}
                    onChange={onChange}
                    onBlur={onBlur}
                    placeholder={expected.program?.path || ""}
                    intent={valid ? undefined : Intent.DANGER}
                    title={message}
                    rightElement={
                      <Button disabled={value.length === 0 || pending} minimal intent={Intent.PRIMARY} text={t("Test")} onClick={onProgramPathTestClick} />
                    }
                  />
                  {isScoped ? null : <Button
                    disabled={pending}
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
          if (value && expected.api?.connectionString) {
            if (expected.api?.connectionString !== value) {
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
                  disabled={pending}
                  fill
                  id={name}
                  name={name}
                  inputRef={ref}
                  value={value}
                  onChange={onChange}
                  onBlur={onBlur}
                  placeholder={expected.api?.connectionString || ""}
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
    // Pick first enabled engine
    const engine = engines.find(it => it.enabled);
    if (engine) {
      // Pick first connector matching engine
      connector = connectors.find(it => it.adapter === engine.adapter && it.engine === engine.engine);
    }
  }

  const methods = useForm<ConnectorFormData>({
    mode: "all",
    reValidateMode: "onChange",
    shouldUseNativeValidation: false,
    defaultValues: {
      scope: connector?.settings.current.controller?.scope || "",
      controllerPath: connector?.settings.current.controller?.path,
      programPath: connector?.settings.current.program.path,
      connectionString: connector?.settings.current.api.connectionString
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
    const engineUserSettings: EngineConnectorSettings = {
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
      const nextSettings = { id: connector.id, settings: engineUserSettings };
      const settings: EngineConnectorSettings = await setEngineUserSettings(nextSettings);
      console.debug("Post update settings are", settings);
      reset({
        controllerPath: settings.controller?.path,
        programPath: settings.program?.path,
        connectionString: settings.api?.connectionString
      });
      Notification.show({ message: t("Container engine settings have been updated"), intent: Intent.SUCCESS });
    } catch (error: any) {
      console.error("Container engine settings updated failed", error.message, error.stack);
      Notification.show({ message: t("Container engine settings update has failed"), intent: Intent.DANGER });
    }
  });

  const onConnectClick = handleSubmit(async (data) => {
    if (connector) {
      const engineUserSettings: EngineConnectorSettings = {
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
      await start({
        startApi: true,
        id: connector.id,
        settings: merge({}, connector.settings.current, engineUserSettings)
      });
    }
    return true;
  });

  const onResetClick = handleSubmit(async (data) => {
    if (!connector) {
      return;
    }
    try {
      const settings: EngineConnectorSettings = await setEngineUserSettings({ id: connector.id, settings: connector?.settings.expected });
      reset({
        scope: settings.controller?.scope || "",
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


  const canConnect = formState.isValid && !pending;
  const canSave = formState.isValid && formState.isDirty && !pending;
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
              <Button disabled={!canConnect} intent={Intent.SUCCESS} text={t("Connect")} icon={IconNames.DATA_CONNECTION} onClick={onConnectClick} />
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
  const podmanConnectors = useMemo(() => connectors.filter(it => it.adapter === ContainerAdapter.PODMAN), [connectors]);
  const dockerConnectors = useMemo(() => connectors.filter(it => it.adapter === ContainerAdapter.DOCKER), [connectors]);

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
