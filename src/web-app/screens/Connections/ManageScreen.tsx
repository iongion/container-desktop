import { Button, ButtonGroup, Callout, Divider, HTMLTable, Intent } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { mdiEmoticonSad, mdiEmoticonWink } from "@mdi/js";
import * as ReactIcon from "@mdi/react";
import { saveAs } from "file-saver";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { getDefaultConnectors } from "@/container-client";
import { Application } from "@/container-client/Application";
import type { Connection, Connector } from "@/env/Types";
import { isEmpty } from "@/utils";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import type { AppScreen, AppScreenProps } from "@/web-app/Types";
import { getFirstUnavailableReason } from "@/web-app/utils/availability";
import { ActionsMenu } from "./ActionsMenu";
import { ManageConnectionDrawer } from "./Connection";
import { ScreenHeader } from "./ScreenHeader";
import "./ManageScreen.css";

// Screen
const isAutoDetectEnabled = false;

interface ScreenProps extends AppScreenProps {}

export const ID = "connections.manage";
export const View = "manage";
export const Title = "Connections";

export const Screen: AppScreen<ScreenProps> = () => {
  const { t } = useTranslation();
  const [editedConnection, setEditedConnection] = useState<Connection | undefined>();
  const [reloadingConnections, setReloadingConnections] = useState(false);
  const provisioned = useAppStore((state) => state.provisioned);
  const running = useAppStore((state) => state.running);
  const currentConnector = useAppStore((state) => state.currentConnector);
  const defaultConnector = useAppStore((state) => state.userSettings.connector?.default);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  const pending = useAppStore((state) => state.pending);
  const [withManageDrawer, setWithManagerDrawer] = useState(false);
  const connections = useAppStore((state) => state.connections);
  const osType = useAppStore((state) => state.osType);
  const refreshConnections = useAppStore((state) => state.getConnections);
  const connectors = useMemo(() => {
    return getDefaultConnectors(osType);
  }, [osType]);
  const runtimeEngineLabelsMap = useMemo(() => {
    return connectors.reduce((acc, it) => {
      acc[`${it.engine}:${it.host}`] = it.label;
      return acc;
    }, {});
  }, [connectors]);

  const onAddConnectionClick = useCallback(() => {
    setEditedConnection(undefined);
    setWithManagerDrawer(true);
  }, []);

  const onReloadConnectionsClick = useCallback(async () => {
    setReloadingConnections(true);
    try {
      await refreshConnections();
    } finally {
      setReloadingConnections(false);
    }
  }, [refreshConnections]);

  const onConnectionsExportClick = useCallback(async () => {
    const connections = await Application.getInstance().getConnections();
    const data = JSON.stringify(
      {
        version: import.meta.env.PROJECT_VERSION,
        connections: connections.map((it) => {
          delete (it as Connector).scopes;
          return it;
        }),
      },
      null,
      2,
    );
    saveAs(new Blob([data], { type: "application/json" }), "container-desktop-connections.json");
  }, []);
  const onConnectionsImportClick = useCallback(async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          const data = e.target?.result;
          if (typeof data === "string") {
            try {
              const imported = JSON.parse(data);
              let connections: Connection[] = [];
              if (Array.isArray(imported)) {
                // older export format: a flat array of connections
                connections = imported.map((it) => {
                  const host = it.engine;
                  const engine = it.runtime;
                  it.engine = engine;
                  it.host = host;
                  delete it.runtime;
                  return it;
                });
              } else {
                connections = imported.connections || [];
              }
              if (connections.length === 0) {
                Notification.show({
                  message: t("Unable to import connections - empty list"),
                  intent: Intent.DANGER,
                });
              } else {
                await setGlobalUserSettings({ connections });
                await refreshConnections();
                Notification.show({
                  message: t("Connections have been imported"),
                  intent: Intent.SUCCESS,
                });
              }
            } catch (_error: any) {
              Notification.show({
                message: t("Unable to import connections - invalid format"),
                intent: Intent.DANGER,
              });
            }
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  }, [t, setGlobalUserSettings, refreshConnections]);

  const onEditConnection = useCallback((connection: Connection) => {
    setEditedConnection(connection);
    setWithManagerDrawer(true);
  }, []);

  const onConnectionManageDrawerClose = useCallback(() => {
    setEditedConnection(undefined);
    setWithManagerDrawer(false);
  }, []);

  let title = "";
  let errorMessage = "";
  let icon: any;
  const connectionFailureReason = currentConnector?.availability?.api
    ? undefined
    : getFirstUnavailableReason(currentConnector?.availability);
  const hasDefaultConnection = Boolean(
    defaultConnector && connections.some((connection) => connection.id === defaultConnector),
  );

  if (connections.length === 0) {
    title = t("No connections defined");
    errorMessage = t("To be able to continue, at least one connection needs to be defined.");
    icon = mdiEmoticonSad;
  } else if (currentConnector && !currentConnector.availability?.api) {
    title = t("Connection failed");
    errorMessage = connectionFailureReason?.reason
      ? t("Connection to {{name}} failed: {{reason}}", {
          name: currentConnector.name,
          reason: connectionFailureReason.reason,
        })
      : t("Connection to {{name}} failed.", {
          name: currentConnector.name,
        });
    icon = mdiEmoticonSad;
  } else if (!hasDefaultConnection) {
    title = t("No default connection");
    errorMessage = t("To be able to start automatically, a default connection needs to be set.");
    icon = mdiEmoticonWink;
  } else if (!currentConnector) {
    title = t("No active connection");
    errorMessage = t("To be able to continue, a connection needs to be established.");
    icon = mdiEmoticonWink;
  } else {
    icon = mdiEmoticonWink;
  }

  const contentWidget =
    provisioned && running ? null : (
      <Callout
        className="AppSettingsCallout"
        title={title}
        icon={icon ? <ReactIcon.Icon path={icon} size={3} /> : undefined}
      >
        <p>{errorMessage}</p>
      </Callout>
    );

  useEffect(() => {
    (async () => {
      await refreshConnections();
    })();
  }, [refreshConnections]);

  const headerActions = (
    <>
      <ButtonGroup variant="minimal" className="ConnectionsExportImport">
        <Button
          disabled={connections.length === 0}
          text={t("Export")}
          title={
            connections.length === 0
              ? t("No connections defined - nothing to export")
              : t("Exports the current list of connections")
          }
          icon={IconNames.EXPORT}
          intent={Intent.NONE}
          onClick={onConnectionsExportClick}
        />
        <Button
          text={t("Import")}
          title={t("Imports and replaces the current list of connections")}
          icon={IconNames.IMPORT}
          intent={Intent.NONE}
          onClick={onConnectionsImportClick}
        />
      </ButtonGroup>
      <ButtonGroup>
        <Button
          text={t("Create connection")}
          title={t("Define a new container host connection")}
          icon={IconNames.PLUS}
          intent={Intent.PRIMARY}
          onClick={onAddConnectionClick}
        />
        <Button
          title={t("Reload connections")}
          icon={IconNames.REFRESH}
          intent={Intent.NONE}
          disabled={pending || reloadingConnections}
          loading={reloadingConnections}
          onClick={onReloadConnectionsClick}
        />
        {isAutoDetectEnabled ? (
          <>
            <Divider />
            <Button text={t("Auto detect")} icon={IconNames.SEARCH} intent={Intent.NONE} />
          </>
        ) : null}
      </ButtonGroup>
    </>
  );

  return (
    <div className="AppScreen" data-screen={ID}>
      <ScreenHeader currentScreen={ID} rightContent={headerActions} />
      <div className="AppScreenContent">
        {contentWidget}
        <div className="AppSettingsEngineManager">
          <div className="AppSettingsEngineManagerConnections">
            <HTMLTable compact striped interactive className="AppDataTable" data-table="host.connections">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t("Connection")}</th>
                  <th>{t("Engine")}</th>
                  <th>{t("Platform")}</th>
                  <th>{t("Autostart")}</th>
                  <th>{t("Rootful")}</th>
                  <th>{t("Default")}</th>
                  <th>&nbsp;</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((connection, index) => {
                  const scopeLabel =
                    runtimeEngineLabelsMap[`${connection.engine}:${connection.host}`] || connection.host;
                  const isCurrent = currentConnector?.connectionId === connection?.id;
                  const isConnected = isCurrent && currentConnector.availability.api;
                  const isAutomatic = connection.settings.mode === "mode.automatic";
                  const descriptions = [connection.settings?.api?.connection?.uri || "", connection.description || ""];
                  const description = descriptions.filter((it) => !isEmpty(it)).join(". ");
                  return (
                    <tr
                      key={connection.id}
                      data-connection-id={connection.id}
                      data-connection-engine={connection.engine}
                      data-connection-host={connection.host}
                      data-connection-is-rootfull={connection.settings?.rootfull ? "yes" : "no"}
                      data-connection-is-default={defaultConnector === connection.id ? "yes" : "no"}
                      data-connection-is-current={isCurrent ? "yes" : "no"}
                      data-connection-is-connected={isConnected ? "yes" : "no"}
                      data-connection-is-system={connection.readonly ? "yes" : "no"}
                    >
                      <td>{index + 1}.</td>
                      <td>
                        <p className="PlatformConnectionName">{connection.name}</p>
                        {description ? <p className="PlatformConnectionDescription">{description}</p> : null}
                      </td>
                      <td>{connection.engine}</td>
                      <td>
                        <p className="PlatformScopeName">
                          {isAutomatic ? t("Auto") : connection.settings?.controller?.scope || ""}
                        </p>
                        <p className="PlatformScopeLabel">{scopeLabel}</p>
                      </td>
                      <td>{connection.settings.api.autoStart ? t("Yes") : t("No")}</td>
                      <td>{isAutomatic ? t("Detect") : connection.settings.rootfull ? t("Yes") : t("No")}</td>
                      <td data-flag="default">
                        {defaultConnector === connection.id ? <strong>{t("Yes")}</strong> : t("No")}
                      </td>
                      <td>
                        <ActionsMenu onEdit={onEditConnection} connection={connection} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </HTMLTable>
            {withManageDrawer ? (
              <ManageConnectionDrawer
                mode={editedConnection ? "edit" : "create"}
                connection={editedConnection}
                onClose={onConnectionManageDrawerClose}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};

Screen.ID = ID;
Screen.Title = Title;
Screen.Route = {
  Path: `/screens/connections/${View}`,
};
Screen.Metadata = {
  LeftIcon: IconNames.DATA_CONNECTION,
  ExcludeFromSidebar: true,
};
