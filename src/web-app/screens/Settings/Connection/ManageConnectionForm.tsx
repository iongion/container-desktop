/* eslint-disable jsx-a11y/no-autofocus */
import { Button, ButtonGroup, Classes, Divider, FormGroup, InputGroup, Intent, Spinner, SpinnerSize, Switch, Tab, Tabs, UL } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { isEmpty } from "lodash-es";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { AbstractContainerEngineHostClient, ContainerEngineOptions, createConnectorBy } from "@/container-client";
import { Application } from "@/container-client/Application";
import { Connection, Connector, ContainerEngine, ContainerEngineHost, ControllerScope, OperatingSystem, Program } from "@/env/Types";
import { deepMerge } from "@/utils";
import { useStoreActions, useStoreState } from "@/web-app/domain/types";
import { Notification } from "@/web-app/Notification";
import { EngineHostSelect } from "./EngineHostSelect";
import { EngineSelect } from "./EngineSelect";
import { OSTypeSelect } from "./OSTypeSelect";
import { ScopeSelect } from "./ScopeSelect";

import classNames from "classnames";
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
  const [isCustomApiConnectionRelayEditable, setCustomApiConnectionRelayEditable] = useState(false);
  const isNativeApplication = useStoreState((state) => state.native);
  const detectedOsType = useStoreState((state) => state.osType);
  const connectors = useStoreState((state) => state.connectors);
  const createConnection = useStoreActions((actions) => actions.settings.createConnection);
  const updateConnection = useStoreActions((actions) => actions.settings.updateConnection);
  const { control, handleSubmit, reset, setValue, getValues } = useForm<Connector>({ defaultValues: connection });
  const [osType, setHostOSType] = useState(detectedOsType);
  const engine = useWatch({ control, name: "engine" });
  const host = useWatch({ control, name: "host" });
  const scopes = useWatch({ control, name: "scopes" });
  const program = useWatch({ control, name: "settings.program" });
  const controller = useWatch({ control, name: "settings.controller" });
  const controllerScopeName = useWatch({ control, name: "settings.controller.scope" });
  const controllerScope: ControllerScope | undefined = useMemo(() => {
    if (!controllerScopeName) return undefined;
    return (scopes || []).find((it) => it.Name === controllerScopeName);
  }, [scopes, controllerScopeName]);
  const [containerEngineHostOptions, setContainerEngineHostOptions] = useState(connectors.filter((it) => it.engine === engine));

  const labels = useMemo(() => {
    const controllerPath = t("Path to {{name}} executable", controller);
    let apiConnectionUri = t("UNIX socket");
    let controllerScope = t("Controller scopes");
    let programPath = program ? t("Path to {{name}} executable", program) : t("Path to executable");
    if (osType === OperatingSystem.Windows) {
      apiConnectionUri = t("Windows named pipe");
    }
    switch (host) {
      case ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR:
        programPath = t("Path to {{name}} executable inside the podman machine", program);
        controllerScope = t("Podman machine");
        break;
      case ContainerEngineHost.PODMAN_VIRTUALIZED_WSL:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_WSL:
        programPath = t("Path to {{name}} executable inside the distribution", program);
        controllerScope = t("WSL distribution");
        break;
      case ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA:
      case ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA:
        programPath = t("Path to {{name}} executable inside the instance", program);
        controllerScope = t("LIMA instance");
        break;
      case ContainerEngineHost.PODMAN_REMOTE:
      case ContainerEngineHost.DOCKER_REMOTE:
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
  }, [t, osType, host, controller, program]);
  const controllerScopeLabel = labels.controllerScope;
  const flags = useMemo(() => {
    // Options
    const withOSTypeSelect = false;
    const withController = [
      ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR,
      ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
      ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
      ContainerEngineHost.PODMAN_REMOTE,
      // ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR, // No scopes exist for Docker - such as Podman machines
      ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
      ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
      ContainerEngineHost.DOCKER_REMOTE
    ].includes(host);
    const withCustomControllerPath = withController && ![ContainerEngineHost.PODMAN_VIRTUALIZED_WSL, ContainerEngineHost.DOCKER_VIRTUALIZED_WSL].includes(host);
    const withCustomControllerScope = withController;
    const withCustomProgramPath = host !== ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR;
    const withCustomApiConnectionUri = host !== ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR;
    const withCustomApiConnectionRelay = host !== ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR;
    const withScopeSelected = !isEmpty(controllerScopeName);
    const withApiRelay = ![ContainerEngineHost.DOCKER_NATIVE, ContainerEngineHost.PODMAN_NATIVE].includes(host);
    const programWidgetPosition = withController ? "after-scope" : "before-controller";
    // Flags
    const isWSL = osType === OperatingSystem.Windows && [ContainerEngineHost.PODMAN_VIRTUALIZED_WSL, ContainerEngineHost.DOCKER_VIRTUALIZED_WSL].includes(host);
    const isProgramBrowseEnabled = isNativeApplication && !withController;
    const isCustomApiConnectionUriReadonly = isCustomApiConnectionUriEditable ? false : !withCustomApiConnectionUri;
    const isCustomApiConnectionRelayReadonly = isCustomApiConnectionRelayEditable ? false : !withCustomApiConnectionRelay;
    const isCustomProgramPathReadonly = isCustomProgramPathEditable ? false : !withCustomProgramPath;
    let isCustomApiConnectionUriDetectDisabled = false;
    let isCustomApiConnectionRelayDetectDisabled = false;
    let executableDetectButtonTitle = "";
    let isProgramPathDetectDisabled = false;
    if (withCustomControllerScope) {
      isProgramPathDetectDisabled = isEmpty(controllerScopeName);
      if (withScopeSelected) {
        isProgramPathDetectDisabled = !controllerScope?.Usable;
        isCustomApiConnectionUriDetectDisabled = !controllerScope?.Usable;
        isCustomApiConnectionRelayDetectDisabled = !controllerScope?.Usable;
      } else {
        executableDetectButtonTitle = t("{{label}} must first be selected", { label: controllerScopeLabel });
        isProgramPathDetectDisabled = true;
        isCustomApiConnectionUriDetectDisabled = true;
        isCustomApiConnectionRelayDetectDisabled = true;
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
      withCustomApiConnectionRelay,
      withApiRelay,
      programWidgetPosition,
      isWSL,
      isProgramBrowseEnabled,
      isCustomApiConnectionUriDetectDisabled,
      isCustomApiConnectionRelayDetectDisabled,
      isCustomApiConnectionUriReadonly,
      isCustomApiConnectionRelayReadonly,
      isCustomProgramPathReadonly,
      isProgramPathDetectDisabled,
      executableDetectButtonTitle
    };
  }, [
    t,
    osType,
    host,
    controllerScope,
    isNativeApplication,
    isCustomProgramPathEditable,
    isCustomApiConnectionUriEditable,
    isCustomApiConnectionRelayEditable,
    controllerScopeName,
    controllerScopeLabel
  ]);

  // Helpers
  const resetFormData = useCallback(
    (userValues: Connection) => {
      const values = getValues();
      reset({
        ...userValues,
        name: values.name
      });
    },
    [reset, getValues]
  );

  const fetchControllerScopes = useCallback(
    async (connector: Connection, skipReset?: boolean) => {
      let updated = connector as Connector;
      try {
        setPending(true);
        console.debug(">> Detecting controller scopes", connector);
        const instance = Application.getInstance();
        const result = await instance.getControllerScopes(connector, true);
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
        resetFormData(updated);
      }
      return updated;
    },
    [t, resetFormData]
  );
  const startControllerScope = useCallback(
    async (scope: ControllerScope) => {
      const connector = getValues();
      const instance = Application.getInstance();
      const flag = await instance.startScope(scope, connector, false);
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
      const flag = await instance.stopScope(scope, connector, false);
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
        console.debug(">> Updating connection", data);
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
  const onContainerEngineDetectClick = useCallback(
    async (engine: ContainerEngine) => {
      try {
        setPending(true);
        setContainerEngineHostOptions(connectors.filter((it) => it.engine === engine));
        console.debug("Detecting container engine", engine);
      } catch (error: any) {
        console.error("Error during container engine detection", error);
        Notification.show({ message: t("Error during engine detection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, connectors]
  );
  const onContainerEngineChange = useCallback(
    async (engine: ContainerEngine) => {
      try {
        setPending(true);
        setContainerEngineHostOptions(connectors.filter((it) => it.engine === engine));
        console.debug("Detecting container engine", engine);
        const updated = createConnectorBy(osType, engine);
        resetFormData(updated);
      } catch (error: any) {
        console.error("Error during container engine detection", error);
      } finally {
        setPending(false);
      }
    },
    [connectors, resetFormData, osType]
  );
  const onContainerEngineHostDetectClick = useCallback(
    async (host: ContainerEngineHost) => {
      try {
        setPending(true);
        console.debug("Detecting container host", host);
      } catch (error: any) {
        console.error("Unable to detect host", error);
        Notification.show({ message: t("Error during engine host detection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t]
  );
  const onContainerEngineHostChange = useCallback(
    async (host: ContainerEngineHost) => {
      try {
        setPending(true);
        console.debug("Detecting container host", host);
        const connector = createConnectorBy(osType, engine, host);
        const updated = await fetchControllerScopes(connector, true);
        if (engine === ContainerEngine.PODMAN) {
          // These should default to auto-start
          const autoStartHosts = [ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR, ContainerEngineHost.PODMAN_VIRTUALIZED_WSL, ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA];
          if (autoStartHosts.includes(host)) {
            updated.settings.api.autoStart = true;
          }
        }
        resetFormData(updated);
      } catch (error: any) {
        console.error("Unable to create connection", error);
        Notification.show({ message: t("Error during connector creation"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, resetFormData, osType, engine, fetchControllerScopes]
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
    const updated = await fetchControllerScopes(connector);
    if (!updated?.scopes?.length) {
      Notification.show({ message: t("No {{controllerScope}} detected - setup required", labels), intent: Intent.WARNING });
    }
  }, [getValues, fetchControllerScopes, labels, t]);
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
        }
        console.debug("<< Controller scope updated", JSON.parse(JSON.stringify(updated)));
        resetFormData(updated);
      } catch (error: any) {
        console.error("Error during controller scope change", error);
        Notification.show({ message: t("Error during controller scope change"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, getValues, resetFormData]
  );
  const onApiConnectionUriDetectClick = useCallback(async () => {
    const connection = getValues();
    try {
      console.debug(">> Detecting API connection URI", connection);
      setPending(true);
      const instance = Application.getInstance();
      const connectionApi = await instance.getConnectionApi<AbstractContainerEngineHostClient>(connection, false);
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
  const onApiConnectionRelayDetectClick = useCallback(async () => {
    const connection = getValues();
    try {
      console.debug(">> Detecting API connection relay", connection);
      setPending(true);
      const instance = Application.getInstance();
      const connectionApi = await instance.getConnectionApi<AbstractContainerEngineHostClient>(connection, false);
      const apiConnection = await connectionApi.getApiConnection();
      setValue("settings.api.connection.uri", apiConnection.uri);
      setValue("settings.api.connection.relay", apiConnection.relay);
      console.debug("<< Detecting API connection relay", connection);
    } catch (error: any) {
      console.error("<< Detecting API connection relay", error);
      Notification.show({ message: t("Error during API connection relay detection"), intent: Intent.DANGER });
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
  const onToggleCustomApiConnectionRelayEditability = useCallback(() => {
    setCustomApiConnectionRelayEditable((prev) => !prev);
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
            ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
            ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
            // Docker
            ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
            ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA
          ].includes(connector.host)
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
        resetFormData(inspected);
      } catch (error: any) {
        console.error("Error during executable selection", error);
        Notification.show({ message: t("Error during executable selection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, getValues, resetFormData, fetchControllerScopes]
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
            ContainerEngineHost.PODMAN_VIRTUALIZED_WSL,
            ContainerEngineHost.PODMAN_VIRTUALIZED_LIMA,
            ContainerEngineHost.PODMAN_REMOTE,
            // Docker
            ContainerEngineHost.DOCKER_VIRTUALIZED_WSL,
            ContainerEngineHost.DOCKER_VIRTUALIZED_LIMA,
            ContainerEngineHost.DOCKER_REMOTE
          ].includes(connector.host)
        ) {
          insideScope = true;
        }
        if (detectTarget === "program" && !insideScope) {
          insideScope = [
            // Podman - supports Podman machines
            ContainerEngineHost.PODMAN_VIRTUALIZED_VENDOR
          ].includes(connector.host);
        }
        if (detectTarget === "controller") {
          insideScope = false;
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
        resetFormData(inspected);
      } catch (error: any) {
        console.error("Error during executable detection", error);
        Notification.show({ message: t("Error during executable selection"), intent: Intent.DANGER });
      } finally {
        setPending(false);
      }
    },
    [t, getValues, resetFormData, fetchControllerScopes]
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
      resetFormData(connection);
      fetchControllerScopes(connection);
    }
  }, [resetFormData, connection, fetchControllerScopes]);

  return (
    <form className={classNames(Classes.DIALOG_BODY, "ManageConnectionForm")} onSubmit={onSubmit}>
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
      {pending && (
        <div className="AppDrawerPendingIndicator">
          <Spinner intent={Intent.SUCCESS} size={SpinnerSize.SMALL} />
          <span>{t("Please wait ...")}</span>
        </div>
      )}
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
                  items={ContainerEngineOptions}
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

        <FormGroup disabled={pending} label={t("Container host")} labelFor="host">
          <Controller
            control={control}
            name="host"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <EngineHostSelect
                  pending={pending}
                  disabled={pending}
                  withoutDetect
                  items={containerEngineHostOptions}
                  host={value}
                  inputProps={{ disabled: pending, id: name, name, onBlur, inputRef: ref }}
                  onChange={async (item) => {
                    await onChange(item);
                    await onContainerEngineHostChange(item);
                  }}
                  onDetect={onContainerEngineHostDetectClick}
                />
              );
            }}
          />
        </FormGroup>

        {/* Program path widget */}
        {flags.programWidgetPosition === "before-controller" && host ? programPathWidget : null}

        {/* Program path widget */}
        {flags.withCustomControllerPath && host ? (
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
        {flags.withCustomControllerScope && host ? (
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

        {/* Connection api start */}
        {host ? (
          <FormGroup className="ContainerStartupFormGroup" disabled={pending} labelFor="settings.api.autoStart" label={t("Container startup")}>
            <Controller
              control={control}
              name="settings.api.autoStart"
              render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
                return (
                  <Switch
                    label={t("Auto-start the engine host if not already running")}
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

        {host ? (
          <Controller
            control={control}
            name="settings.mode"
            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
              return (
                <Tabs id="ConnectionSettingsMode" className="ConnectionSettingsMode" fill selectedTabId={value} onChange={onChange}>
                  <Tab
                    id="mode.automatic"
                    title={t("Automatic")}
                    disabled={pending}
                    panel={
                      <>
                        <UL>
                          <li>
                            <p>{t("Connection settings are automatically detected")}</p>
                          </li>
                          <li>
                            <p>{t("Go to Manual mode to set-up advanced connection details")}</p>
                          </li>
                        </UL>
                      </>
                    }
                    panelClassName="AutomaticSettingsPanel"
                  />
                  <Tab
                    id="mode.manual"
                    title={t("Manual")}
                    disabled={pending}
                    panel={
                      <>
                        {flags.programWidgetPosition === "after-scope" ? programPathWidget : null}

                        {/* Connection api */}
                        <FormGroup disabled={pending} label={labels.apiConnectionUri} labelFor="settings.api.connection.uri" helperText={t("Used as API connection URI")}>
                          <Controller
                            control={control}
                            name="settings.api.connection.uri"
                            render={({ field: { onChange, onBlur, value, name, ref }, fieldState: { invalid } }) => {
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
                                  <div className="ApiConnectionUriInput">
                                    <InputGroup
                                      fill
                                      autoFocus
                                      readOnly={flags.isCustomApiConnectionRelayReadonly}
                                      disabled={pending || host === ContainerEngineHost.DOCKER_VIRTUALIZED_VENDOR}
                                      id={name}
                                      name={name}
                                      value={value || ""}
                                      onBlur={onBlur}
                                      onChange={onChange}
                                      inputRef={ref}
                                      intent={invalid ? Intent.DANGER : Intent.NONE}
                                      placeholder={t("auto")}
                                      rightElement={
                                        flags.withCustomApiConnectionRelay ? undefined : (
                                          <ButtonGroup minimal>
                                            <Button
                                              disabled={pending}
                                              small
                                              title={t("Managed by {{name}} - click to override", program)}
                                              icon={isCustomApiConnectionRelayEditable ? IconNames.UNLOCK : IconNames.LOCK}
                                              intent={Intent.NONE}
                                              data-target="program"
                                              onClick={onToggleCustomApiConnectionRelayEditability}
                                            />
                                          </ButtonGroup>
                                        )
                                      }
                                    />
                                    <Divider />
                                    <ButtonGroup minimal>
                                      <Button
                                        disabled={pending || flags.isCustomApiConnectionRelayDetectDisabled}
                                        small
                                        text={t("Detect")}
                                        intent={Intent.SUCCESS}
                                        onClick={onApiConnectionRelayDetectClick}
                                      />
                                    </ButtonGroup>
                                  </div>
                                );
                              }}
                            />
                          </FormGroup>
                        ) : null}
                      </>
                    }
                    panelClassName="ManualSettingsPanel"
                  />
                </Tabs>
              );
            }}
          />
        ) : null}

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
