/* eslint-disable jsx-a11y/no-autofocus */
import { Button, ButtonGroup, Classes, Divider, FormGroup, InputGroup, Intent, ProgressBar, Switch } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { isEmpty } from "lodash-es";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AbstractClientEngine, ContainerRuntimeOptions, createConnectorBy } from "@/container-client";
import { Application } from "@/container-client/Application";
import { Connection, Connector, ContainerEngine, ContainerRuntime, ControllerScope, Program } from "@/env/Types";
import { OperatingSystem } from "@/platform";
import { deepMerge } from "@/utils";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { Notification } from "@/web-app/Notification";
import { EngineSelect } from "./EngineSelect";
import { OSTypeSelect } from "./OSTypeSelect";
import { RuntimeSelect } from "./RuntimeSelect";
import { ScopeSelect } from "./ScopeSelect";

import "./ManageConnectionForm.css";

type DetectTarget = "program" | "controller";

const withRootfulSupport = false;

export interface ManageConnectionFormProps {
  connection?: Connection;
  mode: "create" | "edit";
  onClose: () => void;
}

export const ManageConnectionForm: React.FC<ManageConnectionFormProps> = ({ mode, connection, onClose }: ManageConnectionFormProps) => {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [isCustomProgramPathEditable, setCustomProgramPathEditable] = useState(false);
  const [isCustomApiConnectionUriEditable, setCustomApiConnectionUriEditable] = useState(false);
  const isNativeApplication = useStoreState((state) => state.native);
  const detectedOsType = useStoreState((state) => state.osType);
  const connectors = useStoreState((state) => state.connectors);
  const createConnection = useStoreActions((actions) => actions.settings.createConnection);
  const updateConnection = useStoreActions((actions) => actions.settings.updateConnection);
  const currentConnector = useStoreState((state) => state.currentConnector);
  const { control, handleSubmit, reset, setValue, getValues } = useForm<Connector>({ defaultValues: connection || currentConnector });
  const [osType, setHostOSType] = useState(detectedOsType);
  const runtime = useWatch({ control, name: "runtime" });
  const engine = useWatch({ control, name: "engine" });
  const scopes = useWatch({ control, name: "scopes" });
  const program = useWatch({ control, name: "settings.program" });
  const controller = useWatch({ control, name: "settings.controller" });
  const controllerScopeName = useWatch({ control, name: "settings.controller.scope" });
  const controllerScope: ControllerScope | undefined = useMemo(() => {
    if (!controllerScopeName) return undefined;
    return (scopes || []).find((it) => it.Name === controllerScopeName);
  }, [scopes, controllerScopeName]);
  const [containerEngineOptions, setContainerEngineOptions] = useState(connectors.filter((it) => it.runtime === runtime));

  const labels = useMemo(() => {
    const controllerPath = t("Path to {{name}} executable", controller);
    let apiConnectionUri = t("UNIX socket");
    let controllerScope = t("Controller scopes");
    let programPath = program ? t("Path to {{name}} executable", program) : t("Path to executable");
    if (osType === OperatingSystem.Windows) {
      apiConnectionUri = t("Windows named pipe");
    }
    switch (engine) {
      case ContainerEngine.PODMAN_VIRTUALIZED_VENDOR:
        programPath = t("Path to {{name}} executable inside the podman machine", program);
        controllerScope = t("Podman machine");
        break;
      case ContainerEngine.PODMAN_VIRTUALIZED_WSL:
      case ContainerEngine.DOCKER_VIRTUALIZED_WSL:
        programPath = t("Path to {{name}} executable inside the distribution", program);
        controllerScope = t("WSL distribution");
        break;
      case ContainerEngine.PODMAN_VIRTUALIZED_LIMA:
      case ContainerEngine.DOCKER_VIRTUALIZED_LIMA:
        programPath = t("Path to {{name}} executable inside the instance", program);
        controllerScope = t("LIMA instance");
        break;
      case ContainerEngine.PODMAN_REMOTE:
      case ContainerEngine.DOCKER_REMOTE:
        programPath = t("Path to {{name}} executable inside the ssh connection", program);
        controllerScope = t("SSH Host");
        break;
      default:
        break;
    }
    return {
      apiConnectionUri,
      controllerPath,
      controllerScope,
      programPath
    };
  }, [t, osType, engine, controller, program]);
  const controllerScopeLabel = labels.controllerScope;
  const flags = useMemo(() => {
    // Options
    const withOSTypeSelect = false;
    const withController = [
      ContainerEngine.PODMAN_VIRTUALIZED_VENDOR,
      ContainerEngine.PODMAN_VIRTUALIZED_WSL,
      ContainerEngine.PODMAN_VIRTUALIZED_LIMA,
      ContainerEngine.PODMAN_REMOTE,
      // ContainerEngine.DOCKER_VIRTUALIZED_VENDOR, // No scopes exist for Docker - such as Podman machines
      ContainerEngine.DOCKER_VIRTUALIZED_WSL,
      ContainerEngine.DOCKER_VIRTUALIZED_LIMA,
      ContainerEngine.DOCKER_REMOTE
    ].includes(engine);
    const withCustomControllerPath = withController && ![ContainerEngine.PODMAN_VIRTUALIZED_WSL, ContainerEngine.DOCKER_VIRTUALIZED_WSL].includes(engine);
    const withCustomControllerScope = withController;
    const withCustomProgramPath = engine !== ContainerEngine.PODMAN_VIRTUALIZED_VENDOR;
    const withCustomApiConnectionUri = engine !== ContainerEngine.PODMAN_VIRTUALIZED_VENDOR;
    const withScopeSelected = !isEmpty(controllerScopeName);
    const withApiRelay = ![ContainerEngine.DOCKER_NATIVE, ContainerEngine.PODMAN_NATIVE].includes(engine);
    const programWidgetPosition = withController ? "after-scope" : "before-controller";
    // Flags
    const isProgramBrowseEnabled = isNativeApplication && !withController;
    const isCustomApiConnectionUriReadonly = isCustomApiConnectionUriEditable ? false : !withCustomApiConnectionUri;
    const isCustomApiConnectionRelayReadonly = isCustomApiConnectionUriEditable ? false : !withCustomApiConnectionUri;
    const isCustomProgramPathReadonly = isCustomProgramPathEditable ? false : !withCustomProgramPath;
    let isCustomApiConnectionUriDetectDisabled = false;
    let executableDetectButtonTitle = "";
    let isProgramPathDetectDisabled = false;
    if (withCustomControllerScope) {
      isProgramPathDetectDisabled = isEmpty(controllerScopeName);
      if (withScopeSelected) {
        isProgramPathDetectDisabled = !controllerScope?.Usable;
        isCustomApiConnectionUriDetectDisabled = !controllerScope?.Usable;
      } else {
        executableDetectButtonTitle = t("{{label}} must first be selected", { label: controllerScopeLabel });
        isProgramPathDetectDisabled = true;
        isCustomApiConnectionUriDetectDisabled = true;
      }
    }
    if (!isCustomProgramPathEditable) {
      executableDetectButtonTitle = t("Program path is provided by {{scope}}", { scope: controllerScopeLabel });
    }
    return {
      withOSTypeSelect,
      withController,
      withCustomControllerPath,
      withCustomControllerScope,
      withCustomProgramPath,
      withCustomApiConnectionUri,
      withApiRelay,
      programWidgetPosition,
      isProgramBrowseEnabled,
      isCustomApiConnectionUriDetectDisabled,
      isCustomApiConnectionUriReadonly,
      isCustomApiConnectionRelayReadonly,
      isCustomProgramPathReadonly,
      isProgramPathDetectDisabled,
      executableDetectButtonTitle
    };
  }, [t, engine, controllerScope, isNativeApplication, isCustomProgramPathEditable, isCustomApiConnectionUriEditable, controllerScopeName, controllerScopeLabel]);

  // Helpers
  const fetchControllerScopes = useCallback(
    async (connector: Connection, skipReset?: boolean) => {
      let updated = connector as Connector;
      try {
        setPending(true);
        console.debug(">> Detecting controller scopes", connector);
        const instance = Application.getInstance();
        const result = await instance.getControllerScopes(connector);
        updated = deepMerge<Connector>({}, connector);
        updated.scopes = result;
        // Pick first scope
        if (updated.settings.controller) {
          // Choose default scope if not present or not set
          let updateScope = false;
          if (updated.settings.controller.scope) {
            updateScope = !result.some((it) => it.Name === updated.settings.controller?.scope);
          }
          if (updateScope) {
            updated.settings.controller.scope = result.length ? result[0].Name : "";
          }
        }
      } catch (error: any) {
        console.error("Unable to detect controller scope", error);
        Notification.show({ message: t("Error during controller scope detection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
      if (!skipReset) {
        console.debug("<< Detected controller scopes", updated);
        reset(updated);
      }
      return updated;
    },
    [t, reset]
  );
  const startControllerScope = useCallback(
    async (scope: ControllerScope) => {
      const connector = getValues();
      const instance = Application.getInstance();
      const flag = await instance.startScope(scope, connector);
      if (flag && connector.scopes) {
        try {
          await fetchControllerScopes(connector);
        } catch (error: any) {
          console.error("Unable to fetch scopes", error);
        }
      }
      return flag;
    },
    [getValues, fetchControllerScopes]
  );
  const stopControllerScope = useCallback(
    async (scope: ControllerScope) => {
      const connector = getValues();
      const instance = Application.getInstance();
      const flag = await instance.stopScope(scope, connector);
      if (flag && connector.scopes) {
        await fetchControllerScopes(connector);
      }
      return flag;
    },
    [getValues, fetchControllerScopes]
  );

  // Handlers
  const onSubmit = handleSubmit(async (data) => {
    try {
      setPending(true);
      if (mode === "create") {
        await createConnection(data);
      } else {
        await updateConnection({ id: data.id, connection: data });
      }
      onClose();
    } catch (error: any) {
      console.error("Unable to create connection", error);
      Notification.show({ message: t("Error during connection creation"), intent: Intent.DANGER });
    } finally {
      setPending(false);
    }
  });

  // Events
  const onHostOSTypeChange = useCallback((e: OperatingSystem) => {
    setHostOSType(e);
  }, []);
  const onContainerRuntimeDetectClick = useCallback(
    async (runtime: ContainerRuntime) => {
      try {
        setPending(true);
        setContainerEngineOptions(connectors.filter((it) => it.runtime === runtime));
        console.debug("Detecting container runtime", runtime);
      } catch (error: any) {
        console.error("Error during container runtime detection", error);
        Notification.show({ message: t("Error during runtime detection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, connectors]
  );
  const onContainerRuntimeChange = useCallback(
    async (runtime: ContainerRuntime) => {
      try {
        setPending(true);
        setContainerEngineOptions(connectors.filter((it) => it.runtime === runtime));
        console.debug("Detecting container runtime", runtime);
        const updated = createConnectorBy(osType, runtime);
        reset(updated);
      } catch (error: any) {
        console.error("Error during container runtime detection", error);
      } finally {
        setPending(false);
      }
    },
    [connectors, reset, osType]
  );
  const onContainerEngineDetectClick = useCallback(
    async (engine: ContainerEngine) => {
      try {
        setPending(true);
        console.debug("Detecting container engine", engine);
      } catch (error: any) {
        console.error("Unable to detect engine", error);
        Notification.show({ message: t("Error during engine detection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t]
  );
  const onContainerEngineChange = useCallback(
    async (engine: ContainerEngine) => {
      try {
        setPending(true);
        console.debug("Detecting container engine", engine);
        const connector = createConnectorBy(osType, runtime, engine);
        const updated = await fetchControllerScopes(connector, true);
        reset(updated);
      } catch (error: any) {
        console.error("Unable to create connection", error);
        Notification.show({ message: t("Error during connector creation"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, reset, osType, runtime, fetchControllerScopes]
  );
  const onControllerScopeStartClick = useCallback(
    async (scope: ControllerScope) => {
      try {
        setPending(true);
        console.debug(">> Starting", scope);
        const performed = await startControllerScope(scope);
        if (performed) {
          Notification.show({ message: t("{{Name}} has been started", scope), intent: Intent.SUCCESS });
        } else {
          Notification.show({ message: t("{{Name}} could not be started", scope), intent: Intent.DANGER });
        }
      } catch (error: any) {
        console.error("<< Starting", error);
        Notification.show({ message: t("{{Name}} could not be started", scope), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, startControllerScope]
  );
  const onControllerScopeStopClick = useCallback(
    async (scope: ControllerScope) => {
      try {
        setPending(true);
        console.debug(">> Stopping", scope);
        const performed = await stopControllerScope(scope);
        if (performed) {
          Notification.show({ message: t("{{Name}} has been stopped", scope), intent: Intent.SUCCESS });
        } else {
          Notification.show({ message: t("{{Name}} could not be stopped", scope), intent: Intent.DANGER });
        }
      } catch (error: any) {
        console.error("<< Stopping", error);
        Notification.show({ message: t("{{Name}} could not be stopped", scope), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, stopControllerScope]
  );
  const onControllerScopesDetectClick = useCallback(async () => {
    const connector = getValues();
    await fetchControllerScopes(connector);
  }, [getValues, fetchControllerScopes]);
  const onControllerScopeChange = useCallback(
    async (scope: ControllerScope) => {
      try {
        setPending(true);
        const connector = getValues();
        console.debug(">> Controller scope selected", JSON.parse(JSON.stringify(scope)));
        const updated = deepMerge<Connector>({}, connector);
        updated.settings.program.path = ""; // clear path on scope change
        updated.settings.program.version = ""; // clear version on scope change
        if (updated.settings.controller) {
          updated.settings.controller.scope = scope.Name;
          // updated.settings.controller.path = ""; // clear path on scope change
          // updated.settings.controller.version = ""; // clear version on scope change
        }
        console.debug("<< Controller scope updated", JSON.parse(JSON.stringify(updated)));
        reset(updated);
      } catch (error: any) {
        console.error("Error during controller scope change", error);
        Notification.show({ message: t("Error during controller scope change"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, getValues, reset]
  );
  const onApiConnectionUriDetectClick = useCallback(async () => {
    const connection = getValues();
    try {
      console.debug(">> Detecting API connection URI", connection);
      setPending(true);
      const instance = Application.getInstance();
      const connectionApi = await instance.getConnectionApi<AbstractClientEngine>(connection);
      const apiConnection = await connectionApi.getApiConnection();
      setValue("settings.api.connection.uri", apiConnection.uri);
      setValue("settings.api.connection.relay", apiConnection.relay);
      console.debug("<< Detecting API connection URI", connection);
    } catch (error: any) {
      console.error("<< Detecting API connection URI", error);
      Notification.show({ message: t("Error during API connection URI detection"), intent: Intent.DANGER });
    } finally {
      setPending(false);
    }
  }, [t, getValues, setValue]);
  const onToggleCustomProgramPathEditability = useCallback(() => {
    setCustomProgramPathEditable((prev) => !prev);
  }, []);
  const onToggleCustomApiConnectionUriEditability = useCallback(() => {
    setCustomApiConnectionUriEditable((prev) => !prev);
  }, []);
  const onExecutableSelectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const detectTarget = (e.currentTarget.getAttribute("data-target") || "program") as DetectTarget;
      console.debug("Select executable", { target: detectTarget, values: getValues() });
      try {
        setPending(true);
        const instance = Application.getInstance();
        const result = await instance.openFileSelector({
          directory: false,
          multiple: false,
          filters: {
            extensions: ["exe"]
          }
        });
        if (result.filePaths.length === 0) {
          console.debug("No executable selected");
          return;
        }
        const filePath = result.filePaths[0];
        const connector = getValues();
        let inspected = deepMerge<Connector>({}, connector, {
          settings: {
            [detectTarget]: {
              path: filePath
            }
          }
        });
        let insideScope = false;
        if (
          [
            // Podman
            ContainerEngine.PODMAN_VIRTUALIZED_WSL,
            ContainerEngine.PODMAN_VIRTUALIZED_LIMA,
            // Docker
            ContainerEngine.DOCKER_VIRTUALIZED_WSL,
            ContainerEngine.DOCKER_VIRTUALIZED_LIMA
          ].includes(connector.engine)
        ) {
          insideScope = true;
        }
        // Run program version detection
        const lookupProgram = inspected.settings[detectTarget] as Program;
        const foundProgramVersion = await instance.findProgramVersion(connector, lookupProgram, insideScope);
        inspected.settings[detectTarget] = deepMerge<Program>({}, lookupProgram);
        inspected.settings[detectTarget].version = foundProgramVersion;
        // Fetch scopes
        if (!insideScope) {
          inspected = await fetchControllerScopes(inspected, true);
        }
        reset(inspected);
      } catch (error: any) {
        console.error("Error during executable selection", error);
        Notification.show({ message: t("Error during executable selection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, getValues, reset, fetchControllerScopes]
  );
  const onExecutableDetectClick = useCallback(
    async (e: React.MouseEvent<HTMLElement, MouseEvent>) => {
      const detectTarget = (e.currentTarget.getAttribute("data-target") || "program") as DetectTarget;
      try {
        setPending(true);
        const connector = getValues();
        let inspected = deepMerge<Connector>({}, connector);
        const instance = Application.getInstance();
        let insideScope = false;
        if (
          [
            // Podman
            ContainerEngine.PODMAN_VIRTUALIZED_WSL,
            ContainerEngine.PODMAN_VIRTUALIZED_LIMA,
            // Docker
            ContainerEngine.DOCKER_VIRTUALIZED_WSL,
            ContainerEngine.DOCKER_VIRTUALIZED_LIMA
          ].includes(connector.engine)
        ) {
          insideScope = true;
        }
        if (detectTarget === "program" && !insideScope) {
          insideScope = [
            // Podman - supports Podman machines
            ContainerEngine.PODMAN_VIRTUALIZED_VENDOR
          ].includes(connector.engine);
        }
        // Run program detection
        const lookupProgram = connector.settings[detectTarget] as Program;
        lookupProgram.path = "";
        lookupProgram.version = "";
        console.debug("> Detecting program", lookupProgram);
        const foundProgram = await instance.findProgram(connector, lookupProgram, insideScope);
        console.debug("< Detecting program", foundProgram);
        inspected.settings[detectTarget] = deepMerge<Program>({}, lookupProgram, foundProgram);
        if (!insideScope) {
          inspected = await fetchControllerScopes(inspected, true);
        }
        reset(inspected);
      } catch (error: any) {
        console.error("Error during executable detection", error);
        Notification.show({ message: t("Error during executable selection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, getValues, reset, fetchControllerScopes]
  );

  // Widgets

  const programPathWidget = (
    <FormGroup
      disabled={pending}
      label={labels.programPath}
      labelFor="settings.program.path"
      helperText={program?.version ? t("Detected version {{version}}", program) : t("No version detected")}
    >
      <Controller
        control={control}
        name="settings.program.path"
        render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
          return (
            <div className="PathToExecutable">
              <InputGroup
                fill
                autoFocus
                disabled={pending}
                readOnly={flags.isCustomProgramPathReadonly}
                id={name}
                name={name}
                value={value || ""}
                onBlur={onBlur}
                onChange={onChange}
                inputRef={ref}
                intent={invalid ? Intent.DANGER : Intent.NONE}
                placeholder={t("auto")}
                rightElement={
                  <ButtonGroup minimal>
                    {flags.withCustomProgramPath ? undefined : (
                      <Button
                        disabled={pending}
                        small
                        title={t("Managed by {{name}} - click to override", program)}
                        icon={isCustomProgramPathEditable ? IconNames.UNLOCK : IconNames.LOCK}
                        intent={Intent.NONE}
                        data-target="program"
                        onClick={onToggleCustomProgramPathEditability}
                      />
                    )}
                    {flags.isProgramBrowseEnabled ? (
                      <Button disabled={pending} small text={t("Browse")} intent={Intent.PRIMARY} data-target="program" onClick={onExecutableSelectClick} />
                    ) : null}
                  </ButtonGroup>
                }
              />
              <Divider />
              <ButtonGroup minimal>
                <Button
                  disabled={pending || flags.isProgramPathDetectDisabled}
                  small
                  text={t("Detect")}
                  title={flags.executableDetectButtonTitle}
                  intent={Intent.SUCCESS}
                  data-target="program"
                  onClick={onExecutableDetectClick}
                />
              </ButtonGroup>
            </div>
          );
        }}
      />
    </FormGroup>
  );

  // At load
  useEffect(() => {
    if (connection) {
      reset(connection);
      fetchControllerScopes(connection);
    }
  }, [reset, connection, fetchControllerScopes]);

  return (
    <form className={Classes.DIALOG_BODY} onSubmit={onSubmit}>
      <ButtonGroup fill>
        <Button
          disabled={pending}
          intent={Intent.PRIMARY}
          icon={IconNames.HEAT_GRID}
          title={t("Click to launch creation")}
          text={mode === "create" ? t("Create") : t("Update")}
          type="submit"
        />
      </ButtonGroup>
      <div className="AppDrawerPendingIndicator">{pending && <ProgressBar intent={Intent.SUCCESS} />}</div>
      <div className="AppDataForm" data-form="connection.create">
        <FormGroup disabled={pending} label={t("Connection name")} labelFor="name" helperText={t("Human friendly name to help identify this connection")}>
          <Controller
            control={control}
            name="name"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <InputGroup
                  fill
                  autoFocus
                  disabled={pending}
                  required={true}
                  id={name}
                  name={name}
                  value={value || ""}
                  onBlur={onBlur}
                  onChange={onChange}
                  inputRef={ref}
                  intent={invalid ? Intent.DANGER : Intent.NONE}
                  placeholder={t("Type here to set the connection name")}
                />
              );
            }}
          />
        </FormGroup>

        {flags.withOSTypeSelect ? (
          <FormGroup disabled={pending} label={t("Host OS")} labelFor="osType">
            <OSTypeSelect withoutDetect inputProps={{ disabled: pending }} osType={osType} onChange={onHostOSTypeChange} onDetect={onHostOSTypeChange} />
          </FormGroup>
        ) : null}

        <FormGroup disabled={pending} label={t("Container runtime")} labelFor="runtime">
          <Controller
            control={control}
            name="runtime"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <RuntimeSelect
                  pending={pending}
                  disabled={pending}
                  withoutDetect
                  items={ContainerRuntimeOptions}
                  runtime={value}
                  inputProps={{ disabled: pending, id: name, name, onBlur, inputRef: ref }}
                  onChange={async (item) => {
                    await onChange(item);
                    await onContainerRuntimeChange(item);
                  }}
                  onDetect={onContainerRuntimeDetectClick}
                />
              );
            }}
          />
        </FormGroup>

        <FormGroup disabled={pending} label={t("Container engine")} labelFor="engine">
          <Controller
            control={control}
            name="engine"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <EngineSelect
                  pending={pending}
                  disabled={pending}
                  withoutDetect
                  items={containerEngineOptions}
                  engine={value}
                  inputProps={{ disabled: pending, id: name, name, onBlur, inputRef: ref }}
                  onChange={async (item) => {
                    await onChange(item);
                    await onContainerEngineChange(item);
                  }}
                  onDetect={onContainerEngineDetectClick}
                />
              );
            }}
          />
        </FormGroup>

        {/* Program path widget */}
        {flags.programWidgetPosition === "before-controller" ? programPathWidget : null}

        {/* Program path widget */}
        {flags.withCustomControllerPath ? (
          <FormGroup
            disabled={pending}
            label={t("Path to {{name}} executable", controller)}
            labelFor="settings.controller.path"
            helperText={controller?.version ? t("Detected version {{version}}", controller) : t("No version detected")}
          >
            <Controller
              control={control}
              name="settings.controller.path"
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <div className="PathToExecutable">
                    <InputGroup
                      fill
                      autoFocus
                      disabled={pending}
                      id={name}
                      name={name}
                      value={value || ""}
                      onBlur={onBlur}
                      onChange={onChange}
                      inputRef={ref}
                      intent={invalid ? Intent.DANGER : Intent.NONE}
                      placeholder={t("auto")}
                      rightElement={
                        isNativeApplication ? (
                          <ButtonGroup minimal>
                            <Button disabled={pending} small text={t("Browse")} intent={Intent.PRIMARY} data-target="controller" onClick={onExecutableSelectClick} />
                          </ButtonGroup>
                        ) : undefined
                      }
                    />
                    <Divider />
                    <ButtonGroup minimal>
                      <Button disabled={pending} small text={t("Detect")} intent={Intent.SUCCESS} data-target="controller" onClick={onExecutableDetectClick} />
                    </ButtonGroup>
                  </div>
                );
              }}
            />
          </FormGroup>
        ) : null}

        {/* Controller scope widget*/}
        {flags.withCustomControllerScope ? (
          <FormGroup disabled={pending} label={labels.controllerScope} labelFor="settings.controller.scope">
            <Controller
              control={control}
              name="settings.controller.scope"
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                const connection = getValues();
                return (
                  <ScopeSelect
                    pending={pending}
                    disabled={pending}
                    detectLabel={null}
                    items={connection.scopes || []}
                    scope={value}
                    inputProps={{ disabled: pending, id: name, name, onBlur, inputRef: ref }}
                    onChange={async (scope) => {
                      await onChange(scope);
                      await onControllerScopeChange(scope);
                    }}
                    onDetect={onControllerScopesDetectClick}
                    onStart={onControllerScopeStartClick}
                    onStop={onControllerScopeStopClick}
                  />
                );
              }}
            />
          </FormGroup>
        ) : null}

        {/* Program path widget - program in scope */}
        {flags.programWidgetPosition === "after-scope" ? programPathWidget : null}

        {/* Connection api */}
        <FormGroup disabled={pending} label={labels.apiConnectionUri} labelFor="settings.api.connection.uri" helperText={t("Used as API connection URI")}>
          <Controller
            control={control}
            name="settings.api.connection.uri"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              const apiConnectionUriDetectButtonTitle = "";
              return (
                <div className="ApiConnectionUriInput">
                  <InputGroup
                    fill
                    autoFocus
                    disabled={pending}
                    readOnly={flags.isCustomApiConnectionUriReadonly}
                    id={name}
                    name={name}
                    value={value || ""}
                    onBlur={onBlur}
                    onChange={onChange}
                    inputRef={ref}
                    intent={invalid ? Intent.DANGER : Intent.NONE}
                    placeholder={t("auto")}
                    rightElement={
                      flags.withCustomApiConnectionUri ? undefined : (
                        <ButtonGroup minimal>
                          <Button
                            disabled={pending}
                            small
                            title={t("Managed by {{name}} - click to override", program)}
                            icon={isCustomApiConnectionUriEditable ? IconNames.UNLOCK : IconNames.LOCK}
                            intent={Intent.NONE}
                            data-target="program"
                            onClick={onToggleCustomApiConnectionUriEditability}
                          />
                        </ButtonGroup>
                      )
                    }
                  />
                  <Divider />
                  <ButtonGroup minimal>
                    <Button
                      disabled={pending || flags.isCustomApiConnectionUriDetectDisabled}
                      small
                      text={t("Detect")}
                      title={apiConnectionUriDetectButtonTitle}
                      intent={Intent.SUCCESS}
                      onClick={onApiConnectionUriDetectClick}
                    />
                  </ButtonGroup>
                </div>
              );
            }}
          />
        </FormGroup>

        {/* Connection api relay */}
        {flags.withApiRelay ? (
          <FormGroup disabled={pending} label={t("API connection relay")} labelFor="settings.api.connection.relay">
            <Controller
              control={control}
              name="settings.api.connection.relay"
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <InputGroup
                    fill
                    autoFocus
                    readOnly={flags.isCustomApiConnectionRelayReadonly}
                    disabled={pending || engine === ContainerEngine.DOCKER_VIRTUALIZED_VENDOR}
                    id={name}
                    name={name}
                    value={value || ""}
                    onBlur={onBlur}
                    onChange={onChange}
                    inputRef={ref}
                    placeholder={t("auto")}
                    intent={invalid ? Intent.DANGER : Intent.NONE}
                  />
                );
              }}
            />
          </FormGroup>
        ) : null}

        {/* Connection api start */}
        <FormGroup disabled={pending} labelFor="settings.api.autoStart">
          <Controller
            control={control}
            name="settings.api.autoStart"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <Switch
                  label={t("Auto-start API")}
                  inline
                  autoFocus
                  disabled={pending}
                  id={name}
                  name={name}
                  checked={value || false}
                  onBlur={onBlur}
                  onChange={onChange}
                  inputRef={ref}
                />
              );
            }}
          />
        </FormGroup>
        {withRootfulSupport ? (
          <FormGroup disabled={pending} labelFor="settings.rootfull">
            <Controller
              control={control}
              name="settings.rootfull"
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <Switch
                    label={t("Rootful container mode - requires elevation")}
                    inline
                    autoFocus
                    disabled={pending}
                    id={name}
                    name={name}
                    checked={value || false}
                    onBlur={onBlur}
                    onChange={onChange}
                    inputRef={ref}
                  />
                );
              }}
            />
          </FormGroup>
        ) : null}
      </div>
    </form>
  );
};
