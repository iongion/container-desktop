import { Button, ButtonGroup, Intent, MenuDivider, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Connection } from "@/container-client/types/connection";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { ConnectIcon, DisconnectIcon } from "@/web-app/components/icons/ConnectionIcons";
import { ResourceListActions } from "@/web-app/components/ResourceListActions";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";
import { useResourceStore } from "@/web-app/stores/resourceStore";

import "./ActionsMenu.css";
import { createLogger } from "@/logger";
import { getConnectionUrl } from "./Navigation";

const logger = createLogger("web.connections");

interface ActionsMenuProps {
  connection: Connection;
  onEdit?: (connection: Connection) => void;
}

interface ConnectionDetailsActionsMenuProps {
  connectionId: string;
  currentScreen: string;
  onReload: () => void;
}

interface PerformActionOptions {
  confirm?: {
    success?: boolean;
    error?: boolean;
  };
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({ connection, onEdit }: ActionsMenuProps) => {
  const { t } = useTranslation();
  const [disabledAction, setDisabledAction] = useState<string | undefined>();
  const [pendingLifecycleAction, setPendingLifecycleAction] = useState<"connect" | "disconnect" | undefined>();
  const connectOne = useAppStore((state) => state.connectOne);
  const disconnectOne = useAppStore((state) => state.disconnectOne);
  const removeConnection = useAppStore((state) => state.removeConnection);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
  // Live per-connection status from main's merged snapshot: connected = main has this one up and running.
  const runtime = useResourceStore((state) => state.activeRuntime.find((info) => info.id === connection.id));
  const performActionCommand = useCallback(
    async (
      action: string,
      { confirm }: PerformActionOptions = {
        confirm: { success: true, error: true },
      },
    ) => {
      const result = {
        success: false,
        message: `No action handler for ${action}`,
      };
      setDisabledAction(action);
      try {
        switch (action) {
          case "connection.remove":
            if (connection) {
              result.success = await removeConnection(connection.id);
            }
            break;
          default:
            break;
        }
      } catch (error: any) {
        logger.error("Command execution failed", error);
        Notification.show({
          message: t("Command did not execute properly - {{message}} {{data}}", {
            message: error.message,
            data: error.data,
          }),
          intent: Intent.DANGER,
        });
      }
      setDisabledAction(undefined);
    },
    [connection, removeConnection, t],
  );
  const onEditClick = useCallback(() => {
    onEdit?.(connection);
  }, [onEdit, connection]);
  const onConnectClick = useCallback(async () => {
    setPendingLifecycleAction("connect");
    try {
      // Per-connection connect (always-merged): bring up just this engine via main — no global bootstrap reset.
      await connectOne(connection.id, { trackGlobalPending: false });
    } catch (error: any) {
      logger.error("Unable to connect", error);
    } finally {
      setPendingLifecycleAction(undefined);
    }
  }, [connectOne, connection]);
  const onDisconnectClick = useCallback(async () => {
    setPendingLifecycleAction("disconnect");
    try {
      await disconnectOne(connection.id, { trackGlobalPending: false });
    } finally {
      setPendingLifecycleAction(undefined);
    }
  }, [disconnectOne, connection]);

  const onRemove = useCallback(
    (tag, confirmed) => {
      if (confirmed) {
        performActionCommand("connection.remove");
      }
    },
    [performActionCommand],
  );
  const onMakeDefault = useCallback(() => {
    setGlobalUserSettings({
      connector: {
        default: connection.id,
      },
    });
  }, [setGlobalUserSettings, connection]);
  const isConnected = !!runtime?.running;
  const unavailableReason = runtime?.error;
  const lifecyclePending = !!pendingLifecycleAction;
  const connectedOnlyTitle = isConnected ? undefined : t("Connect this engine to open this view");

  const removeWidget = connection ? (
    <ConfirmMenu
      onConfirm={onRemove}
      tag={connection.id}
      title={isConnected ? t("A connected connection cannot be removed") : null}
      disabled={connection.readonly || lifecyclePending || isConnected || disabledAction === "connection.remove"}
    >
      <MenuItem
        icon={IconNames.EYE_OPEN}
        text={t("Connection info")}
        href={getConnectionUrl(connection.id, "connection-info")}
      />
      <MenuItem
        icon={IconNames.DESKTOP}
        text={t("System info")}
        href={isConnected ? getConnectionUrl(connection.id, "system-info") : undefined}
        disabled={!isConnected}
        title={connectedOnlyTitle}
      />
      <MenuItem
        icon={IconNames.PULSE}
        text={t("Engine health")}
        href={isConnected ? getConnectionUrl(connection.id, "health") : undefined}
        disabled={!isConnected}
        title={connectedOnlyTitle}
      />
      <MenuDivider />
      <MenuItem icon={IconNames.TARGET} text={t("Make default")} intent={Intent.NONE} onClick={onMakeDefault} />
      <MenuDivider />
    </ConfirmMenu>
  ) : undefined;
  return (
    <>
      <ButtonGroup>
        <Button
          className="ConnectionToggle"
          size="small"
          disabled={lifecyclePending}
          loading={lifecyclePending}
          icon={isConnected ? <DisconnectIcon /> : <ConnectIcon />}
          intent={isConnected ? Intent.SUCCESS : Intent.NONE}
          text={isConnected ? t("Disconnect") : t("Connect")}
          title={!isConnected && unavailableReason ? unavailableReason : t("Connect")}
          onClick={isConnected ? onDisconnectClick : onConnectClick}
        />
      </ButtonGroup>
      &nbsp;
      <ButtonGroup variant="minimal">
        <Button
          disabled={connection.readonly || lifecyclePending}
          size="small"
          icon={IconNames.EDIT}
          title={connection.readonly ? t("This is a system default connection and cannot be changed") : t("Edit")}
          onClick={onEditClick}
        />
      </ButtonGroup>
      <ButtonGroup>{removeWidget}</ButtonGroup>
    </>
  );
};

export const ConnectionDetailsActionsMenu: React.FC<ConnectionDetailsActionsMenuProps> = ({
  onReload,
}: ConnectionDetailsActionsMenuProps) => {
  // The detail-view navigation (Connection info / System info / Engine health) now lives in the left rail
  // (ConnectionDetailRail), so the header keeps only the reload action.
  return <ResourceListActions onReload={onReload} />;
};
