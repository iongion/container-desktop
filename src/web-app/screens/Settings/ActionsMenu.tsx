import { Button, ButtonGroup, Intent, MenuDivider, MenuItem } from "@blueprintjs/core";
import { IconNames } from "@blueprintjs/icons";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Connection } from "@/env/Types";
import { ConfirmMenu } from "@/web-app/components/ConfirmMenu";
import { Notification } from "@/web-app/Notification";
import { useAppStore } from "@/web-app/stores/appStore";

import "./ActionsMenu.css";

interface ActionsMenuProps {
  connection: Connection;
  onEdit?: (connection: Connection) => void;
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
  const currentConnector = useAppStore((state) => state.currentConnector);
  const [isStarting, setIsStarting] = useState(false);
  const startApplication = useAppStore((state) => state.startApplication);
  const stopApplication = useAppStore((state) => state.stopApplication);
  const removeConnection = useAppStore((state) => state.removeConnection);
  const setGlobalUserSettings = useAppStore((state) => state.setGlobalUserSettings);
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
        console.debug("Command executed", action, result);
        if (confirm?.success) {
          Notification.show({
            message: t("Command completed"),
            intent: Intent.SUCCESS,
          });
        }
      } catch (error: any) {
        console.error("Command execution failed", error);
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
    setIsStarting(true);
    try {
      await startApplication({
        startApi: connection.settings.api.autoStart ?? false,
        connection,
        skipAvailabilityCheck: false,
      });
    } catch (error: any) {
      console.error("Unable to start the application", error);
    } finally {
      setIsStarting(false);
    }
  }, [startApplication, connection]);
  const onDisconnectClick = useCallback(async () => {
    await stopApplication({ stopApi: true, connection });
  }, [stopApplication, connection]);

  const onRemove = useCallback(
    (tag, confirmed) => {
      if (confirmed) {
        performActionCommand("connection.remove");
      }
    },
    [performActionCommand],
  );
  const onMakeDefault = useCallback(() => {
    console.debug("Make default connection", connection.id);
    setGlobalUserSettings({
      connector: {
        default: connection.id,
      },
    });
  }, [setGlobalUserSettings, connection]);
  const isCurrent = currentConnector?.connectionId === connection?.id;
  const isConnected = isCurrent && currentConnector.availability.api;
  const unavailableReason = isCurrent && !isConnected ? currentConnector.availability.reason : undefined;

  const removeWidget = connection ? (
    <ConfirmMenu
      onConfirm={onRemove}
      tag={connection.id}
      title={isCurrent ? t("Current connection cannot be removed") : null}
      disabled={connection.readonly || isStarting || isCurrent || disabledAction === "connection.remove"}
    >
      <MenuItem icon={IconNames.TARGET} text={t("Make default")} intent={Intent.NONE} onClick={onMakeDefault} />
      <MenuDivider />
    </ConfirmMenu>
  ) : undefined;
  return (
    <>
      <ButtonGroup>
        <Button
          className="ConnectionToggle"
          small
          disabled={isStarting}
          icon={isConnected ? IconNames.POWER : IconNames.OFFLINE}
          intent={isConnected ? Intent.SUCCESS : Intent.NONE}
          text={isConnected ? t("Disconnect") : t("Connect")}
          title={!isConnected && unavailableReason?.details ? unavailableReason.details : t("Connect")}
          onClick={isConnected ? onDisconnectClick : onConnectClick}
        />
      </ButtonGroup>
      &nbsp;
      <ButtonGroup minimal>
        <Button
          disabled={connection.readonly || isStarting}
          small
          icon={IconNames.EDIT}
          title={connection.readonly ? t("This is a system default connection and cannot be changed") : t("Edit")}
          onClick={onEditClick}
        />
      </ButtonGroup>
      <ButtonGroup>{removeWidget}</ButtonGroup>
    </>
  );
};
